import { getLanguageLabel } from "@/lib/constants/languages";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  es: "Spanish",
  hi: "Hindi",
  zh: "Chinese",
  ko: "Korean",
  de: "German",
  fr: "French",
};

/** Friendly name for a language code, falling back to Handy's list. */
export const langName = (code: string) =>
  LANG_NAMES[code] ?? getLanguageLabel(code) ?? code;

export const TRANSLATE_LANGS = Object.keys(LANG_NAMES);

/** Languages the language hotkey can be preset to (it translates into English). */
export const HOTKEY_LANGS = TRANSLATE_LANGS.filter((l) => l !== "en");
