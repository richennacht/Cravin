import { type } from "@tauri-apps/plugin-os";
import { commands, type AppSettings } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import { inTauri } from "./runtime";
import type { HotkeySource } from "./translations";

export const HOTKEY_BINDING_ID = "transcribe_language";
export const DEFAULT_HOTKEY = "ctrl+alt+space";
export const DEFAULT_HOTKEY_LANGUAGE = "ja";

/** "This PC's audio" capture is only available on Windows for now. */
export const isWindows = (() => {
  if (!inTauri) return false;
  try {
    return type() === "windows";
  } catch {
    return false;
  }
})();

/** "ctrl+alt+space" → ["Ctrl", "Alt", "Space"] for <kbd>-style chips. */
export const hotkeyParts = (binding: string): string[] =>
  binding
    .split("+")
    .map((p) => formatKeyCombination(p, "unknown"))
    .filter(Boolean);

type CravinKey =
  | "cravin_hotkey_language"
  | "cravin_hotkey_source"
  | "cravin_hotkey_paste";

// Handy's settings store has no updaters for Cravin's keys, so update the
// store optimistically here and roll back if the command fails.
const setCravinSetting = async <K extends CravinKey>(
  key: K,
  value: NonNullable<AppSettings[K]>,
  run: () => Promise<{ status: "ok" | "error" }>,
) => {
  const prev = useSettingsStore.getState().settings?.[key];
  const put = (v: AppSettings[K]) =>
    useSettingsStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, [key]: v } : null,
    }));
  put(value);
  try {
    const result = await run();
    if (result.status === "error") put(prev);
  } catch {
    put(prev);
  }
};

/** The language hotkey's binding and Cravin settings, with setters. */
export function useHotkeySettings() {
  const { settings } = useSettings();
  const source: HotkeySource =
    settings?.cravin_hotkey_source === "system" ? "system" : "mic";
  return {
    binding:
      settings?.bindings?.[HOTKEY_BINDING_ID]?.current_binding ??
      DEFAULT_HOTKEY,
    language: settings?.cravin_hotkey_language || DEFAULT_HOTKEY_LANGUAGE,
    source,
    paste: settings?.cravin_hotkey_paste ?? false,
    everydayLanguage: settings?.selected_language || "auto",
    /** "Hold" or "Press", following the normal shortcut's activation mode. */
    verb: settings?.shortcut_activation === "toggle" ? "Press" : "Hold",
    setLanguage: (language: string) => {
      if (!inTauri) return;
      void setCravinSetting("cravin_hotkey_language", language, () =>
        commands.changeCravinHotkeyLanguageSetting(language),
      );
    },
    setSource: (next: HotkeySource) => {
      if (!inTauri) return;
      void setCravinSetting("cravin_hotkey_source", next, () =>
        commands.changeCravinHotkeySourceSetting(next),
      );
    },
    setPaste: (enabled: boolean) => {
      if (!inTauri) return;
      void setCravinSetting("cravin_hotkey_paste", enabled, () =>
        commands.changeCravinHotkeyPasteSetting(enabled),
      );
    },
  };
}
