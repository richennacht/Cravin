import { useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { useModelStore } from "@/stores/modelStore";
import { inTauri } from "../lib/runtime";

type Row = {
  id: string;
  name: string;
  description: string;
  sizeMb: number;
  languages: number;
  streaming: boolean;
  downloaded: boolean;
  recommended?: boolean;
};

// Shown in the browser preview, where Handy's model manager isn't running.
const PREVIEW_MODELS: Row[] = [
  {
    id: "nemotron",
    name: "Nemotron 3.5 Streaming 0.6B",
    description: "Live partials with a language tag per sentence",
    sizeMb: 640,
    languages: 40,
    streaming: true,
    downloaded: true,
    recommended: true,
  },
  {
    id: "qwen3-asr",
    name: "Qwen3-ASR 1.7B",
    description: "Clean final pass per turn, built-in language ID",
    sizeMb: 1900,
    languages: 30,
    streaming: true,
    downloaded: false,
    recommended: true,
  },
  {
    id: "whisper",
    name: "Whisper Large v3 Turbo",
    description: "Widest language coverage",
    sizeMb: 1600,
    languages: 99,
    streaming: false,
    downloaded: false,
  },
  {
    id: "parakeet",
    name: "Parakeet TDT 0.6B v3",
    description: "Fast, European languages only",
    sizeMb: 480,
    languages: 25,
    streaming: false,
    downloaded: false,
  },
];

const ANSWER_MODELS = [
  {
    name: "Qwen3 1.7B",
    role: "Router, summaries, question detection",
    where: "Local",
  },
  {
    name: "Qwen3 4B Instruct",
    role: "Quick lookups, recaps, short translations",
    where: "Local",
  },
  {
    name: "Claude Haiku 4.5",
    role: "Medium questions on slower machines",
    where: "API",
  },
  {
    name: "Claude Sonnet 5.5",
    role: "Technical, code and screenshot questions",
    where: "API",
  },
];

const fmtSize = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;

const FILTERS = ["All", "Streaming", "Downloaded"] as const;

export default function Models() {
  const store = useModelStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const rows: Row[] = inTauri
    ? store.models.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        sizeMb: m.size_mb,
        languages: m.supported_languages.length,
        streaming: m.supports_streaming,
        downloaded: m.is_downloaded,
        recommended: m.is_recommended,
      }))
    : PREVIEW_MODELS;
  const active = inTauri ? store.currentModel : "nemotron";

  const shown = rows
    .filter(
      (r) =>
        filter === "All" ||
        (filter === "Streaming" ? r.streaming : r.downloaded),
    )
    .sort(
      (a, b) =>
        Number(b.id === active) - Number(a.id === active) ||
        Number(!!b.recommended) - Number(!!a.recommended),
    );

  return (
    <div className="cv-page">
      <header className="cv-page-head">
        <div>
          <h1 className="cv-title">Models</h1>
          <p className="cv-subtitle">
            Everything runs on your machine unless you add an API key.
          </p>
        </div>
      </header>

      <div className="cv-chips">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="cv-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <h2 className="cv-section-title" style={{ marginTop: 0 }}>
        Speech to text
      </h2>
      <div className="cv-list">
        {shown.map((r) => {
          const downloading = inTauri && store.isModelDownloading(r.id);
          const progress = inTauri
            ? store.getDownloadProgress(r.id)
            : undefined;
          return (
            <div key={r.id} className="cv-row">
              <div className="cv-row-main">
                <div className="cv-row-title">
                  {r.name}
                  {r.id === active && (
                    <span className="cv-tag">
                      <Check size={11} /> In use
                    </span>
                  )}
                  {r.recommended && r.id !== active && (
                    <span className="cv-tag">Recommended</span>
                  )}
                  {r.streaming && <span className="cv-tag">Streaming</span>}
                </div>
                <div className="cv-row-desc">{r.description}</div>
              </div>
              <span className="cv-row-aside">
                {r.languages} {r.languages === 1 ? "language" : "languages"} ·{" "}
                {fmtSize(r.sizeMb)}
              </span>
              <div
                style={{
                  width: 104,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                {downloading ? (
                  <span
                    className="cv-progress"
                    title={`${Math.round(progress?.percentage ?? 0)}%`}
                  >
                    <span style={{ width: `${progress?.percentage ?? 0}%` }} />
                  </span>
                ) : r.downloaded ? (
                  <button
                    type="button"
                    className="cv-btn cv-btn-sm"
                    disabled={r.id === active || !inTauri}
                    onClick={() => store.selectModel(r.id)}
                  >
                    {r.id === active ? "Active" : "Use"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cv-btn cv-btn-sm"
                    disabled={!inTauri}
                    onClick={() => store.downloadModel(r.id)}
                  >
                    {downloading ? (
                      <Loader2 size={12} />
                    ) : (
                      <Download size={12} />
                    )}{" "}
                    Get
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="cv-row">
            <span className="cv-row-desc">No models match this filter.</span>
          </div>
        )}
      </div>

      <h2 className="cv-section-title">Answers</h2>
      <div className="cv-list">
        {ANSWER_MODELS.map((m) => (
          <div key={m.name} className="cv-row">
            <div className="cv-row-main">
              <div className="cv-row-title">
                {m.name}
                <span className="cv-tag">{m.where}</span>
              </div>
              <div className="cv-row-desc">{m.role}</div>
            </div>
            <span className="cv-row-aside">Coming next</span>
          </div>
        ))}
      </div>
    </div>
  );
}
