import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Cpu, Cloud, EyeOff, X } from "lucide-react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, getStoredTheme } from "@/lib/utils/theme";
import "../cravin.css";
import { ANSWERS_EVENT, ASK_EVENT } from "../lib/overlay";
import { loadPrefs } from "../lib/runtime";
import type { LiveAnswer } from "../lib/useSession";

applyTheme(getStoredTheme());

function AssistOverlay() {
  const [answers, setAnswers] = useState<LiveAnswer[]>([]);
  const [question, setQuestion] = useState("");
  const hidden = loadPrefs().hideFromShare;

  useEffect(() => {
    const unlisten = listen<LiveAnswer[]>(ANSWERS_EVENT, (e) =>
      setAnswers(e.payload),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const ask = () => {
    const q = question.trim();
    if (!q) return;
    emitTo("main", ASK_EVENT, q);
    setQuestion("");
  };

  return (
    <div className="cv-overlay">
      <div className="cv-overlay-head" data-tauri-drag-region>
        <span className="cv-brand-mark" data-tauri-drag-region />
        <span data-tauri-drag-region style={{ fontWeight: 600 }}>
          Assist
        </span>
        {hidden && (
          <span
            className="cv-tag"
            title="Left out of screen shares where the OS allows it"
          >
            <EyeOff size={11} /> Share hiding on
          </span>
        )}
        <span style={{ flex: 1 }} data-tauri-drag-region />
        <button
          type="button"
          className="cv-icon-btn"
          aria-label="Close overlay"
          onClick={() => getCurrentWindow().close()}
        >
          <X size={14} />
        </button>
      </div>
      <div className="cv-assist-body">
        {answers.length === 0 ? (
          <div className="cv-empty" style={{ fontSize: 12.5 }}>
            Suggestions show up here during a session.
          </div>
        ) : (
          answers.slice(0, 3).map((a) => (
            <div key={a.id} className="cv-note">
              <div className="cv-note-head">
                <span>{a.question ?? "Suggested answer"}</span>
                <span style={{ flex: 1 }} />
                <span className="cv-tag">
                  {a.tier === "local" ? <Cpu size={11} /> : <Cloud size={11} />}
                  {a.model}
                </span>
              </div>
              <p>
                {a.text.slice(0, a.shown)}
                {a.shown < a.text.length && <span className="cv-caret" />}
              </p>
              {a.reply && a.shown >= a.text.length && (
                <>
                  <p style={{ marginTop: 8 }}>{a.reply.text}</p>
                  <div className="cv-romaji">{a.reply.romaji}</div>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <form
        className="cv-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          className="cv-input"
          placeholder="Ask about this meeting"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="submit"
          className="cv-btn cv-btn-primary cv-btn-sm"
          disabled={!question.trim()}
        >
          Ask
        </button>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AssistOverlay />
  </React.StrictMode>,
);
