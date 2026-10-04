//! Cravin's language hotkey.
//!
//! The normal transcribe shortcut keeps auto-detecting the spoken language.
//! This binding forces the user's preset language (Japanese by default) for
//! one recording, then translates the result to English and reports every
//! step to the UI as a `cravin://translation` event. It can listen to the
//! microphone or, on Windows, to whatever is playing on the PC.

use crate::audio_feedback::{play_feedback_sound, SoundType};
use crate::audio_toolkit::{LoopbackCapture, VadPolicy};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::ModelManager;
use crate::managers::transcription::{LanguageOverride, TranscriptionManager};
use crate::settings::{get_settings, AppSettings, ShortcutActivation};
use crate::shortcut;
use crate::tray::{set_tray_state, TrayIconState};
use crate::utils;
use log::{debug, error, warn};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const BINDING_ID: &str = "transcribe_language";
pub const TRANSLATION_EVENT: &str = "cravin://translation";

#[derive(Clone, Serialize)]
struct TranslationEvent {
    id: String,
    stage: &'static str,
    language: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    translation: Option<String>,
    translated_by: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    at: i64,
}

impl TranslationEvent {
    fn emit(&self, app: &AppHandle) {
        if let Err(e) = app.emit(TRANSLATION_EVENT, self.clone()) {
            warn!("Failed to emit translation event: {}", e);
        }
    }

    fn stage(mut self, stage: &'static str) -> Self {
        self.stage = stage;
        self
    }

    fn failed(self, app: &AppHandle, message: impl Into<String>) {
        let mut event = self.stage("error");
        event.error = Some(message.into());
        event.emit(app);
    }
}

enum Capture {
    Mic { cancel_generation: u64 },
    System(LoopbackCapture),
}

struct Active {
    event: TranslationEvent,
    capture: Capture,
    pressed_at: Instant,
    /// A short tap in hold-or-toggle mode keeps recording until the next press.
    latched: bool,
}

struct HotkeyState {
    active: Option<Active>,
    key_down: bool,
}

static STATE: Mutex<HotkeyState> = Mutex::new(HotkeyState {
    active: None,
    key_down: false,
});

/// Drive the hotkey from raw key events, honouring the same activation mode
/// as the normal transcribe shortcut.
pub fn handle_key(app: &AppHandle, is_pressed: bool) {
    let settings = get_settings(app);
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());

    // A mic recording cancelled with Escape leaves our state behind; drop it.
    if let Some(Active {
        capture: Capture::Mic { .. },
        ..
    }) = &state.active
    {
        if !app.state::<Arc<AudioRecordingManager>>().is_recording() {
            state.active = None;
        }
    }

    if is_pressed {
        if state.key_down {
            return; // key repeat
        }
        state.key_down = true;
        match state.active.take() {
            None => state.active = start(app, &settings),
            Some(active) => finish(app, active),
        }
        return;
    }

    state.key_down = false;
    let Some(active) = state.active.as_mut() else {
        return;
    };
    let stop_now = match settings.shortcut_activation {
        ShortcutActivation::Toggle => false,
        ShortcutActivation::PushToTalk => true,
        ShortcutActivation::HoldOrToggle => {
            let held = active.pressed_at.elapsed();
            if !active.latched && held < Duration::from_millis(settings.hold_threshold_ms) {
                active.latched = true;
                false
            } else {
                true
            }
        }
    };
    if stop_now {
        if let Some(active) = state.active.take() {
            finish(app, active);
        }
    }
}

fn start(app: &AppHandle, settings: &AppSettings) -> Option<Active> {
    let now = chrono::Utc::now().timestamp_millis();
    let event = TranslationEvent {
        id: format!("tr-{}", now),
        stage: "listening",
        language: settings.cravin_hotkey_language.clone(),
        source: settings.cravin_hotkey_source.clone(),
        source_text: None,
        translation: None,
        translated_by: None,
        error: None,
        at: now,
    };

    let tm = app.state::<Arc<TranscriptionManager>>();
    tm.initiate_model_load();
    if !tm.is_model_loaded() {
        if let Err(e) = app
            .state::<Arc<ModelManager>>()
            .get_model_path(&settings.selected_model)
        {
            warn!("Language hotkey: no model can transcribe ({})", e);
            event.failed(app, "Download a model in Models first.");
            return None;
        }
    }

    let capture = if settings.cravin_hotkey_source == "system" {
        match LoopbackCapture::start() {
            Ok(capture) => Capture::System(capture),
            Err(e) => {
                error!("Language hotkey: system audio capture failed: {}", e);
                event.failed(app, e);
                return None;
            }
        }
    } else {
        let rm = app.state::<Arc<AudioRecordingManager>>();
        let cancel_generation = rm.cancel_generation();
        // No live streaming here: the stream would use the everyday language.
        let policy = if settings.vad_enabled {
            VadPolicy::Offline
        } else {
            VadPolicy::Disabled
        };
        match rm.try_start_recording(BINDING_ID, policy) {
            Ok(_readiness) => {
                shortcut::register_cancel_shortcut(app);
                Capture::Mic { cancel_generation }
            }
            Err(e) => {
                error!("Language hotkey: microphone failed: {}", e);
                event.failed(app, format!("Couldn't start the microphone: {}", e));
                return None;
            }
        }
    };

    set_tray_state(app, TrayIconState::Recording);
    utils::show_recording_overlay(app);
    play_feedback_sound(app, SoundType::Start);
    event.emit(app);
    debug!("Language hotkey started ({})", event.source);

    Some(Active {
        event,
        capture,
        pressed_at: Instant::now(),
        latched: false,
    })
}

fn finish(app: &AppHandle, active: Active) {
    let Active { event, capture, .. } = active;
    let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
    if matches!(capture, Capture::Mic { .. }) {
        shortcut::unregister_cancel_shortcut(app);
    }
    play_feedback_sound(app, SoundType::Stop);
    set_tray_state(app, TrayIconState::Transcribing);
    utils::show_transcribing_overlay(app);
    event.clone().stage("transcribing").emit(app);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            run(&worker_app, capture, &rm, event);
        })
        .await;
        if let Err(e) = result {
            error!("Language hotkey worker failed: {}", e);
        }
        utils::hide_recording_overlay(&app);
        set_tray_state(&app, TrayIconState::Idle);
    });
}

fn run(app: &AppHandle, capture: Capture, rm: &AudioRecordingManager, event: TranslationEvent) {
    let samples = match capture {
        Capture::Mic { cancel_generation } => {
            match rm.stop_recording(BINDING_ID, cancel_generation) {
                Some(samples) => samples,
                None => {
                    event.failed(app, "Cancelled.");
                    return;
                }
            }
        }
        Capture::System(capture) => match capture.stop() {
            Ok(samples) => samples,
            Err(e) => {
                event.failed(app, e);
                return;
            }
        },
    };
    if samples.iter().all(|s| s.abs() < 1e-4) {
        let note = if event.source == "system" {
            "Nothing was playing on this PC."
        } else {
            "No speech was picked up."
        };
        event.failed(app, note);
        return;
    }

    let tm = app.state::<Arc<TranscriptionManager>>();
    let language = event.language.clone();
    let source_text = match tm.transcribe_with_language(
        samples.clone(),
        Some(LanguageOverride {
            language: language.clone(),
            translate_to_english: false,
        }),
    ) {
        Ok(text) => text.trim().to_string(),
        Err(e) => {
            error!("Language hotkey transcription failed: {}", e);
            tm.maybe_unload_immediately("language hotkey");
            event.failed(app, e.to_string());
            return;
        }
    };
    if source_text.is_empty() {
        event.failed(app, "No speech was picked up.");
        return;
    }

    let mut event = event.stage("translating");
    event.source_text = Some(source_text.clone());
    event.emit(app);

    let settings = get_settings(app);
    if language == "en" {
        event.translation = Some(source_text);
    } else if model_can_translate(app, &tm, &settings) {
        match tm.transcribe_with_language(
            samples,
            Some(LanguageOverride {
                language,
                translate_to_english: true,
            }),
        ) {
            Ok(text) if !text.trim().is_empty() => {
                event.translation = Some(text.trim().to_string());
                event.translated_by = Some("whisper");
            }
            Ok(_) => event.error = Some("The model returned no translation.".to_string()),
            Err(e) => event.error = Some(format!("Translation failed: {}", e)),
        }
    } else if let Some(text) =
        tauri::async_runtime::block_on(llm_translate(&settings, &source_text))
    {
        event.translation = Some(text);
        event.translated_by = Some("llm");
    } else {
        event.error = Some(
            "This model can't translate. Pick Whisper Small, Medium or Large in Models."
                .to_string(),
        );
    }
    tm.maybe_unload_immediately("language hotkey");

    let paste = settings.cravin_hotkey_paste;
    let translation = event.translation.clone();
    event.stage("done").emit(app);

    if let Some(text) = translation.filter(|t| paste && !t.is_empty()) {
        let paste_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = utils::paste(text, paste_app.clone()) {
                error!("Failed to paste translation: {}", e);
                let _ = paste_app.emit("paste-error", ());
            }
        });
    }
}

fn model_can_translate(app: &AppHandle, tm: &TranscriptionManager, settings: &AppSettings) -> bool {
    let model_id = tm
        .get_current_model()
        .unwrap_or_else(|| settings.selected_model.clone());
    app.state::<Arc<ModelManager>>()
        .get_model_info(&model_id)
        .is_some_and(|info| info.supports_translation)
}

/// Fall back to the post-processing LLM provider, when one is configured.
async fn llm_translate(settings: &AppSettings, text: &str) -> Option<String> {
    let provider = settings.active_post_process_provider()?.clone();
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return None;
    }
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    let system = "Translate the user's text into natural English. Reply with the translation only."
        .to_string();
    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.to_string(),
        Some(system),
        None,
        false,
    )
    .await
    {
        Ok(Some(content)) if !content.trim().is_empty() => Some(content.trim().to_string()),
        Ok(_) => None,
        Err(e) => {
            warn!("LLM translation failed: {}", e);
            None
        }
    }
}
