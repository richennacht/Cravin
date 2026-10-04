import { useEffect } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "./runtime";

export const TRANSLATION_EVENT = "cravin://translation";

export type TranslationStage =
  | "listening"
  | "transcribing"
  | "translating"
  | "done"
  | "error";

export type HotkeySource = "mic" | "system";

/** One language hotkey use, as emitted by the backend at each stage. */
export type TranslationEvent = {
  id: string; // one id per hotkey use
  stage: TranslationStage;
  language: string; // the preset source language, e.g. "ja"
  source: HotkeySource;
  source_text?: string; // transcript in the source language (from "translating" on)
  translation?: string; // English, on "done" (absent if no translator is available)
  translated_by?: "whisper" | "llm" | null;
  error?: string; // on "error", or a note on "done"
  at: number; // ms since epoch when the hotkey use started
};

const STORE_KEY = "cravin.translations";
const MAX_SAVED = 50;

export const isFinished = (t: TranslationEvent) =>
  t.stage === "done" || t.stage === "error";

const STAGES: readonly string[] = [
  "listening",
  "transcribing",
  "translating",
  "done",
  "error",
];

/** Guard against malformed payloads (and old or foreign localStorage data). */
export const isTranslationEvent = (v: unknown): v is TranslationEvent => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.stage === "string" &&
    STAGES.includes(o.stage) &&
    typeof o.language === "string" &&
    typeof o.at === "number"
  );
};

const loadSaved = (): TranslationEvent[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTranslationEvent).filter(isFinished);
  } catch {
    return [];
  }
};

const save = (items: TranslationEvent[]) => {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify(items.filter(isFinished).slice(0, MAX_SAVED)),
    );
  } catch {
    // Storage can be unavailable; history just won't survive a restart.
  }
};

/** Insert or replace by id, newest first. */
export const upsertTranslation = (
  items: TranslationEvent[],
  next: TranslationEvent,
): TranslationEvent[] =>
  [next, ...items.filter((t) => t.id !== next.id)].sort((a, b) => b.at - a.at);

type TranslationsState = {
  items: TranslationEvent[];
  clear: () => void;
};

const useTranslationStore = create<TranslationsState>()((set) => ({
  items: loadSaved(),
  clear: () => set({ items: [] }),
}));

let lastSaved: TranslationEvent[] | null = null;
useTranslationStore.subscribe((s) => {
  if (s.items === lastSaved) return;
  lastSaved = s.items;
  save(s.items);
});

let listening = false;

/**
 * Start listening for language hotkey results. Safe to call more than once;
 * the listener lives for the whole app so nothing is missed while another
 * page is open.
 */
export const startTranslationListener = () => {
  if (!inTauri || listening) return;
  listening = true;
  listen<unknown>(TRANSLATION_EVENT, (e) => {
    if (!isTranslationEvent(e.payload)) return;
    const payload = e.payload;
    useTranslationStore.setState((s) => ({
      items: upsertTranslation(s.items, payload),
    }));
  }).catch(() => {
    listening = false;
  });
};

/** Language hotkey results, newest first, plus `clear()`. */
export function useTranslations() {
  useEffect(startTranslationListener, []);
  const items = useTranslationStore((s) => s.items);
  const clear = useTranslationStore((s) => s.clear);
  return { items, clear };
}

/** True while a language hotkey use is still in progress. */
export const useTranslationActive = () =>
  useTranslationStore((s) => s.items.some((t) => !isFinished(t)));

export const STAGE_LABEL: Record<TranslationStage, string> = {
  listening: "Listening…",
  transcribing: "Transcribing…",
  translating: "Translating…",
  done: "Done",
  error: "Something went wrong",
};

export const SOURCE_LABEL: Record<HotkeySource, string> = {
  mic: "Microphone",
  system: "This PC's audio",
};
