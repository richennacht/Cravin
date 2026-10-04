import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type AiModel,
  type AiSource,
  type AiStatus,
} from "@/bindings";
import { inTauri } from "./runtime";

const AI_PREFS_KEY = "cravin.ai";
const DELTA_EVENT = "chatgpt-delta";

export type AiPrefs = { source: AiSource | null; model: string | null };

export const SOURCE_LABELS: Record<AiSource, string> = {
  chatgpt: "ChatGPT plan",
  api_key: "OpenAI API key",
};

export const loadAiPrefs = (): AiPrefs => {
  try {
    const raw = localStorage.getItem(AI_PREFS_KEY);
    if (raw) return { source: null, model: null, ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable; nothing picked is fine.
  }
  return { source: null, model: null };
};

const saveAiPrefs = (prefs: AiPrefs): void => {
  try {
    localStorage.setItem(AI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
};

const unwrap = <T>(
  r: { status: "ok"; data: T } | { status: "error"; error: string },
): T => {
  if (r.status === "error") throw new Error(r.error);
  return r.data;
};

/** Sources the user can answer with right now. */
export const availableSources = (status: AiStatus | null): AiSource[] => {
  if (!status) return [];
  const out: AiSource[] = [];
  if (status.signed_in && status.plan_usage) out.push("chatgpt");
  if (status.api_key_set) out.push("api_key");
  return out;
};

/** The saved source if it still works, else the first one that does. */
const pickSource = (status: AiStatus | null, saved: AiSource | null) => {
  const sources = availableSources(status);
  return saved && sources.includes(saved) ? saved : (sources[0] ?? null);
};

export function useAi() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [prefs, setPrefs] = useState<AiPrefs>(loadAiPrefs);
  const [models, setModels] = useState<AiModel[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = pickSource(status, prefs.source);

  const update = useCallback((next: Partial<AiPrefs>) => {
    setPrefs((prev) => {
      const merged = { ...prev, ...next };
      saveAiPrefs(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    commands
      .aiStatus()
      .then((r) => setStatus(unwrap(r)))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!source) {
      setModels([]);
      return;
    }
    let live = true;
    commands
      .aiListModels(source)
      .then((r) => {
        if (!live) return;
        const list = unwrap(r);
        setModels(list);
        setPrefs((prev) => {
          if (prev.model && list.some((m) => m.slug === prev.model))
            return prev;
          const merged = { ...prev, model: list[0]?.slug ?? null };
          saveAiPrefs(merged);
          return merged;
        });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [source, status]);

  const run = async (action: () => Promise<AiStatus>) => {
    setError(null);
    try {
      setStatus(await action());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return {
    status,
    source,
    model: prefs.model,
    models,
    signingIn,
    error,
    setSource: (s: AiSource) => update({ source: s, model: null }),
    setModel: (m: string) => update({ model: m }),
    signIn: async () => {
      setSigningIn(true);
      await run(async () => {
        const next = unwrap(await commands.chatgptSignIn());
        update({ source: "chatgpt", model: null });
        return next;
      });
      setSigningIn(false);
    },
    cancelSignIn: () => commands.chatgptCancelSignIn(),
    signOut: () => run(async () => unwrap(await commands.chatgptSignOut())),
    setApiKey: (key: string | null) =>
      run(async () => unwrap(await commands.openaiSetApiKey(key))),
  };
}

/** Source and model to answer with, or null when nothing is set up. */
export async function answerConfig(): Promise<{
  source: AiSource;
  model: string;
} | null> {
  if (!inTauri) return null;
  try {
    const status = unwrap(await commands.aiStatus());
    const prefs = loadAiPrefs();
    const source = pickSource(status, prefs.source);
    if (!source) return null;
    // Settings normally saves a model. If it never loaded, take the first.
    const model =
      (source === prefs.source || !prefs.source ? prefs.model : null) ??
      unwrap(await commands.aiListModels(source))[0]?.slug;
    return model ? { source, model } : null;
  } catch {
    return null;
  }
}

let requestCounter = 0;

/** Ask the configured model, calling `onDelta` as text streams in. */
export async function askAi(
  config: { source: AiSource; model: string },
  instructions: string,
  input: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const requestId = `ask-${Date.now()}-${requestCounter++}`;
  const unlisten = await listen<{ request_id: string; delta: string }>(
    DELTA_EVENT,
    (e) => {
      if (e.payload.request_id === requestId) onDelta(e.payload.delta);
    },
  );
  try {
    return unwrap(
      await commands.aiAsk(
        config.source,
        requestId,
        config.model,
        instructions,
        input,
      ),
    );
  } finally {
    unlisten();
  }
}
