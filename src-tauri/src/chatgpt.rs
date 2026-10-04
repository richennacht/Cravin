//! Answers from OpenAI, powered either by the user's ChatGPT plan ("Sign in
//! with ChatGPT", the same account login Codex uses) or by an OpenAI API key.
//!
//! The sign-in follows OpenAI's flow for open-source apps that run locally:
//! OpenID Connect with PKCE against auth.openai.com, a client registered on
//! first sign-in (no client secret), and a loopback redirect. Requests then go
//! to the public Responses API with the access token.
//! https://developers.openai.com/siwc/token-sharing-open-source

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use log::{info, warn};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use specta::Type;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

const ISSUER: &str = "https://auth.openai.com";
const API_BASE: &str = "https://api.openai.com/v1";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// Granted only when the user lets Cravin use their ChatGPT plan.
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const CALLBACK_PATH: &str = "/auth/callback";
const REGISTRATION_CLIENT_ID: &str = "dynamic_agent_client";
const APP_NAME: &str = "Cravin";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Refresh this long before the access token expires.
const REFRESH_MARGIN_SECS: u64 = 60;
pub const DELTA_EVENT: &str = "chatgpt-delta";

const CLIENT_FILE: &str = "chatgpt-client.txt";
const SESSION_FILE: &str = "chatgpt-session.bin";
const API_KEY_FILE: &str = "openai-key.bin";

/// A signed-in ChatGPT account. Holds credentials, so it deliberately has no
/// Debug impl.
#[derive(Serialize, Deserialize, Clone)]
struct Session {
    client_id: String,
    subject: String,
    email: Option<String>,
    name: Option<String>,
    scopes: Vec<String>,
    access_token: String,
    refresh_token: String,
    /// Unix seconds.
    expires_at: u64,
}

#[derive(Default)]
struct Inner {
    loaded: bool,
    session: Option<Session>,
    api_key: Option<String>,
}

#[derive(Default)]
pub struct ChatGpt {
    inner: Mutex<Inner>,
    cancel_sign_in: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Serialize, Type, Clone)]
pub struct AiStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub name: Option<String>,
    /// The user allowed Cravin to use their ChatGPT plan when signing in.
    pub plan_usage: bool,
    pub api_key_set: bool,
}

#[derive(Serialize, Type, Clone)]
pub struct AiModel {
    pub slug: String,
    pub display_name: String,
}

#[derive(Deserialize, Type, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AiSource {
    Chatgpt,
    ApiKey,
}

#[derive(Serialize, Type, Clone)]
pub struct AiDelta {
    pub request_id: String,
    pub delta: String,
}

/// An error with OpenAI's code kept for decisions (like forcing a new sign-in)
/// and a message meant for the user.
#[derive(Debug)]
struct Failure {
    code: String,
    message: String,
}

impl Failure {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    fn needs_sign_in(&self) -> bool {
        matches!(
            self.code.as_str(),
            "invalid_grant"
                | "invalid_refresh_token"
                | "token_expired"
                | "refresh_token_expired"
                | "refresh_token_invalidated"
                | "refresh_token_reused"
        )
    }
}

type Res<T> = Result<T, Failure>;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn network(e: reqwest::Error) -> Failure {
    Failure::new(
        "network_error",
        format!("Couldn't reach OpenAI. Check your connection and try again. ({e})"),
    )
}

fn http_client() -> Res<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent(format!("Cravin/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(network)
}

fn random_token() -> Res<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Failure::new("random_failed", format!("Couldn't start sign-in: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Turn an OpenAI error body into a message the user can act on.
fn api_error(body: &Value, status: u16) -> Failure {
    let mut detail = body;
    for _ in 0..4 {
        match (detail.get("error"), detail.get("detail")) {
            (Some(inner @ Value::Object(_)), _) => detail = inner,
            (_, Some(inner @ Value::Object(_))) => detail = inner,
            _ => break,
        }
    }
    let code = detail
        .get("error")
        .and_then(Value::as_str)
        .or_else(|| detail.get("code").and_then(Value::as_str))
        .unwrap_or("api_error")
        // Older responses spell plan-sharing codes with a v2 infix.
        .replacen("subscription_sharing_v2_", "subscription_sharing_", 1);
    let message = match code.as_str() {
        "subscription_sharing_user_not_eligible" => {
            "Your ChatGPT account can't share its plan with apps. It needs ChatGPT Plus or Pro."
        }
        "subscription_sharing_usage_limit_exceeded" => {
            "You've hit the ChatGPT usage limit for Cravin. Check your limits in ChatGPT Settings, or try again later."
        }
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            "ChatGPT is temporarily unavailable. Try again shortly."
        }
        "subscription_sharing_invalid_user" | "invalid_token" | "chatpass_v2_scope_not_authorized" => {
            "ChatGPT didn't accept this connection. Sign out and sign in again, and allow Cravin to use your plan."
        }
        "subscription_sharing_client_not_enabled" => {
            "OpenAI hasn't enabled plan usage for this app yet."
        }
        "invalid_api_key" => "OpenAI didn't accept this API key.",
        "insufficient_quota" => "This API key has no credit left.",
        "access_denied" => "Sign-in wasn't completed. Try again when you're ready.",
        "model_not_found" => "That model isn't available on this account. Pick another one.",
        "invalid_grant"
        | "invalid_refresh_token"
        | "token_expired"
        | "refresh_token_expired"
        | "refresh_token_invalidated"
        | "refresh_token_reused" => "Your ChatGPT sign-in expired. Sign in again.",
        _ => match status {
            401 => "OpenAI didn't accept these credentials.",
            403 => "OpenAI blocked this request for your account or region.",
            429 => "Too many requests. Wait a moment and try again.",
            500..=599 => "OpenAI is temporarily unavailable. Try again shortly.",
            400 | 422 => "OpenAI rejected the request.",
            _ => "OpenAI couldn't complete the request.",
        },
    };
    Failure::new(&code, message)
}

async fn json_body(response: reqwest::Response) -> (u16, Value) {
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    (status, body)
}

/* ---------- credential storage ---------- */

fn data_dir(app: &AppHandle) -> Res<PathBuf> {
    crate::portable::app_data_dir(app).map_err(|e| {
        Failure::new(
            "storage",
            format!("Couldn't find Cravin's data folder: {e}"),
        )
    })
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Res<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` borrows `data` for the call; DPAPI allocates `output`,
    // which is copied out and released with LocalFree.
    unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| Failure::new("storage", format!("Couldn't encrypt credentials: {e}")))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> Res<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in `protect`.
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| Failure::new("storage", format!("Couldn't decrypt credentials: {e}")))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(bytes)
    }
}

// Windows is the shipping target. Elsewhere credentials are stored as an
// owner-only file until a platform keychain is wired in.
#[cfg(not(windows))]
fn protect(data: &[u8]) -> Res<Vec<u8>> {
    Ok(data.to_vec())
}

#[cfg(not(windows))]
fn unprotect(data: &[u8]) -> Res<Vec<u8>> {
    Ok(data.to_vec())
}

fn write_private(path: &PathBuf, data: &[u8]) -> Res<()> {
    let fail =
        |e: std::io::Error| Failure::new("storage", format!("Couldn't save credentials: {e}"));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(fail)?;
    }
    let tmp = path.with_extension("tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(fail)?;
        file.write_all(data).map_err(fail)?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, data).map_err(fail)?;
    std::fs::rename(&tmp, path).map_err(fail)
}

fn save_secret<T: Serialize>(app: &AppHandle, file: &str, value: &T) -> Res<()> {
    let json = serde_json::to_vec(value)
        .map_err(|e| Failure::new("storage", format!("Couldn't save credentials: {e}")))?;
    write_private(&data_dir(app)?.join(file), &protect(&json)?)
}

fn load_secret<T: for<'de> Deserialize<'de>>(app: &AppHandle, file: &str) -> Option<T> {
    let path = data_dir(app).ok()?.join(file);
    let raw = std::fs::read(&path).ok()?;
    match unprotect(&raw).and_then(|plain| {
        serde_json::from_slice(&plain)
            .map_err(|e| Failure::new("storage", format!("Saved credentials are unreadable: {e}")))
    }) {
        Ok(value) => Some(value),
        Err(e) => {
            warn!("Ignoring {file}: {}", e.message);
            None
        }
    }
}

fn remove_file(app: &AppHandle, file: &str) {
    if let Ok(dir) = data_dir(app) {
        let _ = std::fs::remove_file(dir.join(file));
    }
}

/// The client OpenAI registered for this install. Not a secret; kept across
/// sign-outs so signing in again doesn't register another app.
fn load_client_id(app: &AppHandle) -> Option<String> {
    let path = data_dir(app).ok()?.join(CLIENT_FILE);
    let id = std::fs::read_to_string(path).ok()?.trim().to_string();
    valid_client_id(&id).then_some(id)
}

fn save_client_id(app: &AppHandle, id: &str) -> Res<()> {
    write_private(&data_dir(app)?.join(CLIENT_FILE), id.as_bytes())
}

fn valid_client_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id != REGISTRATION_CLIENT_ID
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/* ---------- OAuth ---------- */

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    revocation_endpoint: Option<String>,
}

async fn discovery(http: &reqwest::Client) -> Res<Discovery> {
    let response = http
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(network)?;
    let invalid = || {
        Failure::new(
            "discovery_failed",
            "Couldn't verify OpenAI's sign-in service.",
        )
    };
    let config: Discovery = response.json().await.map_err(|_| invalid())?;
    let on_issuer = |url: &str| url.starts_with(&format!("{ISSUER}/"));
    if config.issuer != ISSUER
        || !on_issuer(&config.authorization_endpoint)
        || !on_issuer(&config.token_endpoint)
        || config
            .revocation_endpoint
            .as_deref()
            .is_some_and(|u| !on_issuer(u))
    {
        return Err(invalid());
    }
    Ok(config)
}

async fn token_request(
    http: &reqwest::Client,
    endpoint: &str,
    form: &[(&str, &str)],
) -> Res<Value> {
    let response = http
        .post(endpoint)
        .header("accept", "application/json")
        .form(form)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(network)?;
    let (status, body) = json_body(response).await;
    if !(200..300).contains(&status) {
        return Err(api_error(&body, status));
    }
    if !body.is_object() {
        return Err(Failure::new(
            "invalid_token_response",
            "OpenAI returned an invalid sign-in response. Sign in again.",
        ));
    }
    Ok(body)
}

struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scopes: Vec<String>,
}

fn token_fields(data: &Value, previous_scopes: Option<&[String]>) -> Res<Tokens> {
    let incomplete = || {
        Failure::new(
            "invalid_token_response",
            "OpenAI returned incomplete credentials. Sign in again.",
        )
    };
    // OAuth may omit scope on refresh when it hasn't changed.
    let scopes: Vec<String> = match data.get("scope").and_then(Value::as_str) {
        Some(s) => s.split_whitespace().map(str::to_string).collect(),
        None => previous_scopes.ok_or_else(incomplete)?.to_vec(),
    };
    let access_token = data
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let refresh_token = data
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let bearer = data
        .get("token_type")
        .and_then(Value::as_str)
        .is_some_and(|t| t.eq_ignore_ascii_case("bearer"));
    let expires_in = data
        .get("expires_in")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0);
    match (access_token, refresh_token, expires_in) {
        (Some(access), Some(refresh), Some(expires_in)) if bearer => Ok(Tokens {
            access_token: access.to_string(),
            refresh_token: refresh.to_string(),
            expires_at: now() + expires_in,
            scopes,
        }),
        _ => Err(incomplete()),
    }
}

struct Identity {
    subject: String,
    email: Option<String>,
    name: Option<String>,
}

/// Read the ID token's claims and check they were issued by OpenAI for this
/// client. The token arrives straight from OpenAI's token endpoint over TLS,
/// which OpenID Connect Core 3.1.3.7 accepts in place of a signature check.
fn identity(id_token: &str, client_id: &str, nonce: Option<&str>) -> Res<Identity> {
    let invalid = || {
        Failure::new(
            "invalid_id_token",
            "Couldn't verify your ChatGPT identity. Sign in again.",
        )
    };
    let payload = id_token.split('.').nth(1).ok_or_else(invalid)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| invalid())?;
    let claims: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let s = |k: &str| claims.get(k).and_then(Value::as_str);
    let audience_ok = match claims.get("aud") {
        Some(Value::String(a)) => a == client_id,
        Some(Value::Array(list)) => list.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    let fresh = claims
        .get("exp")
        .and_then(Value::as_u64)
        .is_some_and(|exp| exp + 5 >= now());
    if s("iss") != Some(ISSUER)
        || !audience_ok
        || !fresh
        || s("azp").is_some_and(|azp| azp != client_id)
        || nonce.is_some_and(|n| s("nonce") != Some(n))
    {
        return Err(invalid());
    }
    let subject = s("sub").filter(|v| !v.is_empty()).ok_or_else(invalid)?;
    Ok(Identity {
        subject: subject.to_string(),
        email: s("email").map(str::to_string),
        name: s("name").map(str::to_string),
    })
}

struct Callback {
    code: String,
    client_id: Option<String>,
}

const CALLBACK_PAGE: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Back to Cravin</title><style>body{font:16px system-ui;max-width:30rem;margin:18vh auto;padding:24px;color:#202123}h1{font-size:24px}</style><h1>You're signed in</h1><p>Head back to Cravin. You can close this tab.</p></html>";

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, content_type: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Serve the loopback redirect until the browser comes back with our state.
async fn wait_for_callback(listener: &TcpListener, port: u16, state: &str) -> Res<Callback> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| {
            Failure::new(
                "callback_failed",
                format!("The sign-in listener stopped: {e}"),
            )
        })?;
        let mut buf = Vec::with_capacity(2048);
        let read = tokio::time::timeout(Duration::from_secs(10), async {
            let mut chunk = [0u8; 1024];
            while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 16 * 1024 {
                match stream.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                }
            }
        })
        .await;
        if read.is_err() {
            continue;
        }
        let head = String::from_utf8_lossy(&buf);
        let target = head
            .lines()
            .next()
            .and_then(|line| line.strip_prefix("GET "))
            .and_then(|rest| rest.split(' ').next())
            .unwrap_or("");
        let url = match Url::parse(&format!("http://127.0.0.1:{port}{target}")) {
            Ok(url) if url.path() == CALLBACK_PATH => url,
            _ => {
                respond(&mut stream, "404 Not Found", "text/plain", "Not found").await;
                continue;
            }
        };
        let params: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        let get = |key: &str| -> Vec<&str> {
            params
                .iter()
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v.as_str())
                .collect()
        };
        // Unrelated requests to the port must not end the pending sign-in.
        if get("state") != [state] {
            respond(
                &mut stream,
                "400 Bad Request",
                "text/plain",
                "Invalid sign-in state. Go back to the tab that started sign-in.",
            )
            .await;
            continue;
        }
        respond(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            CALLBACK_PAGE,
        )
        .await;
        if let Some(error) = get("error").first() {
            return Err(api_error(&json!({ "error": error }), 400));
        }
        let incomplete = || {
            Failure::new(
                "registration_incomplete",
                "ChatGPT didn't finish setting up Cravin. Try signing in again.",
            )
        };
        let codes = get("code");
        let client_ids = get("client_id");
        if codes.len() != 1 || codes[0].is_empty() || client_ids.len() > 1 {
            return Err(incomplete());
        }
        return Ok(Callback {
            code: codes[0].to_string(),
            client_id: client_ids.first().map(|s| s.to_string()),
        });
    }
}

async fn sign_in(app: &AppHandle, cancel: oneshot::Receiver<()>) -> Res<Session> {
    let http = http_client()?;
    let provider = discovery(&http).await?;
    let saved_client = load_client_id(app);
    let state = random_token()?;
    let nonce = random_token()?;
    let verifier = random_token()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| {
        Failure::new(
            "callback_port_unavailable",
            format!("Couldn't start sign-in: {e}"),
        )
    })?;
    let port = listener
        .local_addr()
        .map_err(|e| {
            Failure::new(
                "callback_port_unavailable",
                format!("Couldn't start sign-in: {e}"),
            )
        })?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    let mut url = Url::parse(&provider.authorization_endpoint).map_err(|_| {
        Failure::new(
            "discovery_failed",
            "Couldn't verify OpenAI's sign-in service.",
        )
    })?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair(
                "client_id",
                saved_client.as_deref().unwrap_or(REGISTRATION_CLIENT_ID),
            )
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", SCOPES)
            .append_pair("resource", API_BASE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &challenge);
        if saved_client.is_none() {
            query.append_pair("agent_name_hint", APP_NAME);
        }
    }
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| {
            Failure::new(
                "browser_unavailable",
                format!("Couldn't open your browser: {e}"),
            )
        })?;

    let callback = tokio::select! {
        result = wait_for_callback(&listener, port, &state) => result?,
        _ = cancel => return Err(Failure::new("cancelled", "Sign-in was cancelled.")),
        _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => {
            return Err(Failure::new("timeout", "Sign-in timed out. Try again."))
        }
    };
    drop(listener);

    let client_id = match (callback.client_id, saved_client) {
        (Some(returned), Some(saved)) if returned != saved => None,
        (Some(returned), _) => Some(returned),
        (None, saved) => saved,
    }
    .filter(|id| valid_client_id(id))
    .ok_or_else(|| {
        Failure::new(
            "registration_incomplete",
            "ChatGPT didn't finish setting up Cravin. Try signing in again.",
        )
    })?;
    // Keep the registration even if the code exchange below fails, so a retry
    // doesn't register Cravin a second time.
    save_client_id(app, &client_id)?;

    let data = token_request(
        &http,
        &provider.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &callback.code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
            ("resource", API_BASE),
        ],
    )
    .await?;
    let id_token = data.get("id_token").and_then(Value::as_str).unwrap_or("");
    let who = identity(id_token, &client_id, Some(&nonce))?;
    let tokens = token_fields(&data, None)?;
    info!(
        "Signed in with ChatGPT (plan usage: {})",
        tokens.scopes.iter().any(|s| s == PLAN_SCOPE)
    );
    Ok(Session {
        client_id,
        subject: who.subject,
        email: who.email,
        name: who.name,
        scopes: tokens.scopes,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
    })
}

async fn refresh(session: &Session) -> Res<Session> {
    let http = http_client()?;
    let provider = discovery(&http).await?;
    let data = token_request(
        &http,
        &provider.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &session.client_id),
            ("refresh_token", &session.refresh_token),
            ("resource", API_BASE),
        ],
    )
    .await?;
    let tokens = token_fields(&data, Some(&session.scopes))?;
    let mut next = session.clone();
    if let Some(id_token) = data.get("id_token").and_then(Value::as_str) {
        let who = identity(id_token, &session.client_id, None)?;
        if who.subject != session.subject {
            return Err(Failure::new(
                "account_mismatch",
                "ChatGPT returned a different account. Sign in again.",
            ));
        }
        next.email = who.email.or(next.email);
        next.name = who.name.or(next.name);
    }
    next.access_token = tokens.access_token;
    next.refresh_token = tokens.refresh_token;
    next.expires_at = tokens.expires_at;
    next.scopes = tokens.scopes;
    Ok(next)
}

async fn revoke(session: &Session) {
    let result = async {
        let http = http_client()?;
        let provider = discovery(&http).await?;
        let Some(endpoint) = provider.revocation_endpoint else {
            return Ok(());
        };
        http.post(endpoint)
            .form(&[
                ("token", session.refresh_token.as_str()),
                ("token_type_hint", "refresh_token"),
                ("client_id", session.client_id.as_str()),
            ])
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(network)?;
        Ok::<(), Failure>(())
    }
    .await;
    if let Err(e) = result {
        warn!("Couldn't revoke ChatGPT session: {}", e.message);
    }
}

/* ---------- state ---------- */

impl ChatGpt {
    async fn load(&self, app: &AppHandle) -> tokio::sync::MutexGuard<'_, Inner> {
        let mut inner = self.inner.lock().await;
        if !inner.loaded {
            inner.session = load_secret(app, SESSION_FILE);
            inner.api_key = load_secret(app, API_KEY_FILE);
            inner.loaded = true;
        }
        inner
    }

    /// A bearer token for `source`, refreshing the ChatGPT session if needed.
    async fn bearer(&self, app: &AppHandle, source: AiSource) -> Res<String> {
        let mut inner = self.load(app).await;
        if source == AiSource::ApiKey {
            return inner.api_key.clone().ok_or_else(|| {
                Failure::new("no_api_key", "Add an OpenAI API key in Settings first.")
            });
        }
        let session = inner
            .session
            .clone()
            .ok_or_else(|| Failure::new("signed_out", "Sign in with ChatGPT in Settings first."))?;
        if session.expires_at > now() + REFRESH_MARGIN_SECS {
            return Ok(session.access_token);
        }
        // Refresh tokens rotate, so this runs under the lock to keep two
        // requests from spending the same one.
        match refresh(&session).await {
            Ok(next) => {
                save_secret(app, SESSION_FILE, &next)?;
                let token = next.access_token.clone();
                inner.session = Some(next);
                Ok(token)
            }
            Err(e) => {
                if e.needs_sign_in() {
                    inner.session = None;
                    remove_file(app, SESSION_FILE);
                }
                Err(e)
            }
        }
    }
}

fn status_of(inner: &Inner) -> AiStatus {
    let session = inner.session.as_ref();
    AiStatus {
        signed_in: session.is_some(),
        email: session.and_then(|s| s.email.clone()),
        name: session.and_then(|s| s.name.clone()),
        plan_usage: session.is_some_and(|s| s.scopes.iter().any(|x| x == PLAN_SCOPE)),
        api_key_set: inner.api_key.is_some(),
    }
}

/* ---------- Responses API ---------- */

async fn list_models(token: &str, source: AiSource) -> Res<Vec<AiModel>> {
    let response = http_client()?
        .get(format!("{API_BASE}/models"))
        .bearer_auth(token)
        .header("accept", "application/json")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(network)?;
    let (status, body) = json_body(response).await;
    if !(200..300).contains(&status) {
        return Err(api_error(&body, status));
    }
    let unexpected = || {
        Failure::new(
            "invalid_model_catalog",
            "OpenAI returned an unexpected model list. Try again.",
        )
    };
    let mut models = Vec::new();
    match source {
        // Plan usage answers with the models this ChatGPT account may use.
        AiSource::Chatgpt => {
            for m in body
                .get("models")
                .and_then(Value::as_array)
                .ok_or_else(unexpected)?
            {
                if m.get("visibility").and_then(Value::as_str) != Some("list") {
                    continue;
                }
                let slug = m
                    .get("slug")
                    .and_then(Value::as_str)
                    .ok_or_else(unexpected)?;
                let name = m
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or(slug);
                models.push(AiModel {
                    slug: slug.to_string(),
                    display_name: name.to_string(),
                });
            }
        }
        // The API lists every model the key can reach, chat or not. Keep the
        // GPT family, which the Responses API serves.
        AiSource::ApiKey => {
            for m in body
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(unexpected)?
            {
                let Some(id) = m.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let skip = [
                    "audio",
                    "realtime",
                    "transcribe",
                    "tts",
                    "image",
                    "search",
                    "embedding",
                ];
                if id.starts_with("gpt-") && !skip.iter().any(|s| id.contains(s)) {
                    models.push(AiModel {
                        slug: id.to_string(),
                        display_name: id.to_string(),
                    });
                }
            }
            models.sort_by(|a, b| b.slug.cmp(&a.slug));
        }
    }
    Ok(models)
}

/// Stream one answer from the Responses API, emitting each text delta.
async fn stream_response(
    app: &AppHandle,
    token: &str,
    request_id: &str,
    model: &str,
    instructions: Option<&str>,
    input: &str,
) -> Res<String> {
    let mut body = json!({
        "model": model,
        "input": [{ "role": "user", "content": input }],
        // Plan usage requires both; they're harmless with an API key.
        "store": false,
        "stream": true,
    });
    if let Some(instructions) = instructions {
        body["instructions"] = json!(instructions);
    }
    let response = http_client()?
        .post(format!("{API_BASE}/responses"))
        .bearer_auth(token)
        .header("accept", "text/event-stream")
        .json(&body)
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .map_err(network)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let (status, body) = json_body(response).await;
        return Err(api_error(&body, status));
    }

    let interrupted = || Failure::new("stream_interrupted", "The answer was cut off. Try again.");
    let mut stream = response.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    let mut data_lines: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut completed = false;

    // Handle one complete SSE event. Returns true once the response is done.
    let dispatch = |data_lines: &mut Vec<String>, text: &mut String| -> Res<bool> {
        let data = data_lines.join("\n");
        data_lines.clear();
        if data.is_empty() || data == "[DONE]" {
            return Ok(false);
        }
        let event: Value = serde_json::from_str(&data).map_err(|_| interrupted())?;
        match event.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    text.push_str(delta);
                    let _ = app.emit(
                        DELTA_EVENT,
                        AiDelta {
                            request_id: request_id.to_string(),
                            delta: delta.to_string(),
                        },
                    );
                }
                Ok(false)
            }
            Some("response.failed") | Some("error") => {
                let detail = event.get("response").unwrap_or(&event);
                Err(api_error(detail, status))
            }
            Some("response.incomplete") => Err(Failure::new(
                "response_incomplete",
                "OpenAI stopped before finishing the answer.",
            )),
            Some("response.completed") => Ok(true),
            _ => Ok(false),
        }
    };

    'read: while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| interrupted())?;
        pending.extend_from_slice(&chunk);
        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                if dispatch(&mut data_lines, &mut text)? {
                    completed = true;
                    break 'read;
                }
            } else if let Some(content) = line.strip_prefix("data:") {
                data_lines.push(content.strip_prefix(' ').unwrap_or(content).to_string());
            }
        }
    }
    if !completed && !data_lines.is_empty() {
        completed = dispatch(&mut data_lines, &mut text)?;
    }
    if !completed {
        return Err(interrupted());
    }
    Ok(text)
}

/* ---------- commands ---------- */

#[tauri::command]
#[specta::specta]
pub async fn ai_status(app: AppHandle, state: State<'_, ChatGpt>) -> Result<AiStatus, String> {
    Ok(status_of(&*state.load(&app).await))
}

/// Open the browser to sign in with ChatGPT and wait for it to come back.
#[tauri::command]
#[specta::specta]
pub async fn chatgpt_sign_in(
    app: AppHandle,
    state: State<'_, ChatGpt>,
) -> Result<AiStatus, String> {
    let (tx, rx) = oneshot::channel();
    // Starting again replaces (and so cancels) a sign-in already waiting.
    *state
        .cancel_sign_in
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(tx);
    let result = sign_in(&app, rx).await;
    let session = result.map_err(|e| e.message)?;
    save_secret(&app, SESSION_FILE, &session).map_err(|e| e.message)?;
    let mut inner = state.load(&app).await;
    inner.session = Some(session);
    Ok(status_of(&inner))
}

#[tauri::command]
#[specta::specta]
pub fn chatgpt_cancel_sign_in(state: State<'_, ChatGpt>) {
    if let Some(tx) = state
        .cancel_sign_in
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = tx.send(());
    }
}

#[tauri::command]
#[specta::specta]
pub async fn chatgpt_sign_out(
    app: AppHandle,
    state: State<'_, ChatGpt>,
) -> Result<AiStatus, String> {
    let mut inner = state.load(&app).await;
    let session = inner.session.take();
    remove_file(&app, SESSION_FILE);
    let status = status_of(&inner);
    drop(inner);
    if let Some(session) = session {
        revoke(&session).await;
    }
    Ok(status)
}

/// Save an OpenAI API key, or remove it with `None`.
#[tauri::command]
#[specta::specta]
pub async fn openai_set_api_key(
    app: AppHandle,
    state: State<'_, ChatGpt>,
    key: Option<String>,
) -> Result<AiStatus, String> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    let mut inner = state.load(&app).await;
    match &key {
        Some(k) => save_secret(&app, API_KEY_FILE, k).map_err(|e| e.message)?,
        None => remove_file(&app, API_KEY_FILE),
    }
    inner.api_key = key;
    Ok(status_of(&inner))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_list_models(
    app: AppHandle,
    state: State<'_, ChatGpt>,
    source: AiSource,
) -> Result<Vec<AiModel>, String> {
    let token = state.bearer(&app, source).await.map_err(|e| e.message)?;
    list_models(&token, source).await.map_err(|e| e.message)
}

/// Answer `input`, streaming text as `chatgpt-delta` events tagged with
/// `request_id`, and return the full answer.
#[tauri::command]
#[specta::specta]
pub async fn ai_ask(
    app: AppHandle,
    state: State<'_, ChatGpt>,
    source: AiSource,
    request_id: String,
    model: String,
    instructions: Option<String>,
    input: String,
) -> Result<String, String> {
    let token = state.bearer(&app, source).await.map_err(|e| e.message)?;
    stream_response(
        &app,
        &token,
        &request_id,
        &model,
        instructions.as_deref(),
        &input,
    )
    .await
    .map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(claims: Value) -> String {
        let part = |v: &Value| URL_SAFE_NO_PAD.encode(serde_json::to_vec(v).unwrap());
        format!("{}.{}.sig", part(&json!({ "alg": "RS256" })), part(&claims))
    }

    fn claims() -> Value {
        json!({
            "iss": ISSUER,
            "aud": "oaiapp_123",
            "sub": "user-1",
            "exp": now() + 600,
            "nonce": "n1",
            "email": "me@example.com",
        })
    }

    #[test]
    fn accepts_matching_identity() {
        let who = identity(&jwt(claims()), "oaiapp_123", Some("n1")).unwrap();
        assert_eq!(who.subject, "user-1");
        assert_eq!(who.email.as_deref(), Some("me@example.com"));
    }

    #[test]
    fn rejects_wrong_audience_nonce_issuer_or_expiry() {
        assert!(identity(&jwt(claims()), "oaiapp_other", Some("n1")).is_err());
        assert!(identity(&jwt(claims()), "oaiapp_123", Some("n2")).is_err());
        let mut c = claims();
        c["iss"] = json!("https://evil.example");
        assert!(identity(&jwt(c), "oaiapp_123", Some("n1")).is_err());
        let mut c = claims();
        c["exp"] = json!(1);
        assert!(identity(&jwt(c), "oaiapp_123", Some("n1")).is_err());
    }

    #[test]
    fn token_fields_need_refresh_token_and_keep_scopes_on_refresh() {
        let data = json!({ "access_token": "a", "token_type": "Bearer", "expires_in": 3600 });
        assert!(token_fields(&data, None).is_err());
        let data = json!({ "access_token": "a", "refresh_token": "r", "token_type": "Bearer", "expires_in": 3600 });
        let previous = vec![PLAN_SCOPE.to_string()];
        let tokens = token_fields(&data, Some(&previous)).unwrap();
        assert_eq!(tokens.scopes, previous);
    }

    #[test]
    fn maps_plan_errors_to_friendly_messages() {
        let e = api_error(
            &json!({ "error": { "code": "subscription_sharing_usage_limit_exceeded" } }),
            429,
        );
        assert!(e.message.contains("usage limit"));
        let e = api_error(&json!({ "error": "invalid_grant" }), 400);
        assert!(e.needs_sign_in());
        let e = api_error(
            &json!({ "detail": { "code": "subscription_sharing_v2_user_not_eligible" } }),
            403,
        );
        assert_eq!(e.code, "subscription_sharing_user_not_eligible");
    }

    #[test]
    fn client_ids_are_validated() {
        assert!(valid_client_id("oaiapp_abc-123"));
        assert!(!valid_client_id(REGISTRATION_CLIENT_ID));
        assert!(!valid_client_id("bad id"));
        assert!(!valid_client_id(""));
    }
}
