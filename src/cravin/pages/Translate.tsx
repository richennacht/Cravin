import { Fragment } from "react";
import { Info } from "lucide-react";
import { useModelStore } from "@/stores/modelStore";
import { HOTKEY_LANGS, langName } from "../lib/languages";
import { inTauri } from "../lib/runtime";
import { hotkeyParts, isWindows, useHotkeySettings } from "../lib/hotkey";
import {
  SOURCE_LABEL,
  STAGE_LABEL,
  isFinished,
  useTranslations,
  type TranslationEvent,
} from "../lib/translations";

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function Hotkey({ binding }: { binding: string }) {
  return (
    <span className="cv-hotkey">
      {hotkeyParts(binding).map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="cv-hotkey-plus">+</span>}
          <kbd className="cv-kbd">{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

function Pending({ text }: { text: string }) {
  return <span style={{ color: "var(--cv-faint)" }}>{text}</span>;
}

function TranslationCard({ item }: { item: TranslationEvent }) {
  const sourceWaiting =
    item.stage === "listening" || item.stage === "transcribing";
  const note = item.error;
  return (
    <div className="cv-tr-card">
      <div>
        <div className="cv-tr-label">
          {langName(item.language)} · {timeOf(item.at)}
          {item.source === "system" && ` · ${SOURCE_LABEL.system}`}
        </div>
        <div className="cv-tr-text">
          {item.source_text ? (
            item.source_text
          ) : sourceWaiting ? (
            <Pending text={STAGE_LABEL[item.stage]} />
          ) : (
            <Pending text="Didn't catch anything" />
          )}
        </div>
      </div>
      <div>
        <div className="cv-tr-label">
          English
          {item.translated_by === "llm" && " · via your AI model"}
        </div>
        <div className="cv-tr-text">
          {item.translation ? (
            item.translation
          ) : !isFinished(item) ? (
            <Pending
              text={
                item.stage === "translating"
                  ? STAGE_LABEL.translating
                  : "Translation appears here"
              }
            />
          ) : item.stage === "error" ? null : (
            <Pending text="No translation" />
          )}
        </div>
        {note && (
          <div
            className={
              item.stage === "error" ? "cv-tr-note cv-tr-error" : "cv-tr-note"
            }
          >
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Translate({
  onOpenModels,
}: {
  onOpenModels: () => void;
}) {
  const { items, clear } = useTranslations();
  const hotkey = useHotkeySettings();
  const models = useModelStore((s) => s.models);
  const currentModel = useModelStore((s) => s.currentModel);
  const model = models.find((m) => m.id === currentModel);
  const cantTranslate =
    inTauri && model !== undefined && !model.supports_translation;

  const langs = HOTKEY_LANGS.includes(hotkey.language)
    ? HOTKEY_LANGS
    : [hotkey.language, ...HOTKEY_LANGS];
  const presetName = langName(hotkey.language);

  return (
    <div className="cv-page">
      <header className="cv-page-head">
        <div>
          <h1 className="cv-title">Translate</h1>
          <p className="cv-subtitle">
            {hotkey.verb} <Hotkey binding={hotkey.binding} /> to hear{" "}
            {presetName} in English.
          </p>
        </div>
        {items.length > 0 && (
          <button type="button" className="cv-btn cv-btn-sm" onClick={clear}>
            Clear
          </button>
        )}
      </header>

      <div className="cv-chips" style={{ alignItems: "center", gap: 16 }}>
        <label className="cv-pair">
          <span className="cv-row-desc">Language</span>
          <select
            className="cv-select"
            disabled={!inTauri}
            value={hotkey.language}
            onChange={(e) => hotkey.setLanguage(e.target.value)}
          >
            {langs.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="cv-pair">
          <span className="cv-row-desc">Listen to</span>
          <select
            className="cv-select"
            disabled={!inTauri}
            value={hotkey.source}
            onChange={(e) =>
              hotkey.setSource(e.target.value === "system" ? "system" : "mic")
            }
          >
            <option value="mic">{SOURCE_LABEL.mic}</option>
            <option value="system" disabled={!isWindows}>
              {SOURCE_LABEL.system}
              {!isWindows && " (Windows only)"}
            </option>
          </select>
        </label>
      </div>

      {cantTranslate && (
        <div className="cv-notice">
          <Info size={14} />
          <span style={{ flex: 1 }}>
            {model.name} can transcribe {presetName} but can't translate it.
            Pick Whisper Small, Medium or Large to get English.
          </span>
          <button
            type="button"
            className="cv-btn cv-btn-sm"
            onClick={onOpenModels}
          >
            Open Models
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="cv-empty" style={{ marginTop: 48 }}>
          <h3>Nothing translated yet</h3>
          <p>
            {hotkey.verb} <Hotkey binding={hotkey.binding} /> and speak (or
            play) {presetName}. English shows up here and in the Assist overlay.
          </p>
        </div>
      ) : (
        <div className="cv-stack">
          {items.map((t) => (
            <TranslationCard key={t.id} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}
