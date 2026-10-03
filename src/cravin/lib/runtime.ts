/** True inside the Tauri desktop shell, false in a plain browser preview. */
export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const PREFS_KEY = "cravin.prefs";

export type Prefs = {
  translateTo: string;
  autoSuggest: boolean;
  liveTranslate: boolean;
  consentReminder: boolean;
  recordingIndicator: boolean;
  hideFromShare: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  translateTo: "en",
  autoSuggest: true,
  liveTranslate: true,
  consentReminder: true,
  recordingIndicator: true,
  hideFromShare: true,
};

// UI-only preferences until the meeting engine owns real settings.
export const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable; defaults are fine.
  }
  return DEFAULT_PREFS;
};

export const savePrefs = (prefs: Prefs): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
};

export const formatClock = (totalSeconds: number): string => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
