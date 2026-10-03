import { useState } from "react";
import { ArrowLeftRight, Play, Pause } from "lucide-react";
import { TRANSLATE_LANGS, langName } from "../lib/demo";
import { formatClock, loadPrefs, savePrefs } from "../lib/runtime";
import { revealSpans, type SessionState } from "../lib/useSession";

export default function Translate({ session }: { session: SessionState }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [theirs, setTheirs] = useState("ja");
  const [replyMode, setReplyMode] = useState(true);

  const setMine = (lang: string) => {
    const next = { ...prefs, translateTo: lang };
    setPrefs(next);
    savePrefs(next);
  };

  const foreignSegs = session.segments.filter(
    (s) =>
      s.side === "them" && s.spans.some((sp) => sp.lang !== prefs.translateTo),
  );
  const reply = session.answers.find(
    (a) => a.reply && a.shown >= a.text.length,
  )?.reply;

  return (
    <div className="cv-page">
      <header className="cv-page-head">
        <div>
          <h1 className="cv-title">Translate</h1>
          <p className="cv-subtitle">
            Live captions in your language, even when they switch mid-sentence.
          </p>
        </div>
        {session.running ? (
          <button type="button" className="cv-btn" onClick={session.pause}>
            <Pause size={14} /> {formatClock(session.elapsed)}
          </button>
        ) : (
          <button
            type="button"
            className="cv-btn cv-btn-primary"
            onClick={session.start}
          >
            <Play size={14} /> Start listening
          </button>
        )}
      </header>

      <div className="cv-chips" style={{ alignItems: "center" }}>
        <div className="cv-pair">
          <select
            className="cv-select"
            value={theirs}
            onChange={(e) => setTheirs(e.target.value)}
          >
            {TRANSLATE_LANGS.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
          <ArrowLeftRight size={14} color="var(--cv-muted)" />
          <select
            className="cv-select"
            value={prefs.translateTo}
            onChange={(e) => setMine(e.target.value)}
          >
            {TRANSLATE_LANGS.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="cv-chip"
          aria-pressed={replyMode}
          onClick={() => setReplyMode(!replyMode)}
        >
          Suggest replies in {langName(theirs)}
        </button>
      </div>

      {foreignSegs.length === 0 ? (
        <div className="cv-tr-card">
          <div>
            <div className="cv-tr-label">{langName(theirs)}</div>
            <div className="cv-tr-text" style={{ color: "var(--cv-faint)" }}>
              Waiting for speech
            </div>
          </div>
          <div>
            <div className="cv-tr-label">{langName(prefs.translateTo)}</div>
            <div className="cv-tr-text" style={{ color: "var(--cv-faint)" }}>
              Translation appears here
            </div>
          </div>
        </div>
      ) : (
        <div className="cv-stack">
          {foreignSegs.map((s) => (
            <div key={s.id} className="cv-tr-card">
              <div>
                <div className="cv-tr-label">
                  Them · {formatClock(s.at)} ·{" "}
                  {[...new Set(s.spans.map((sp) => langName(sp.lang)))].join(
                    " + ",
                  )}
                </div>
                <div
                  className="cv-tr-text"
                  style={s.partial ? { color: "var(--cv-muted)" } : undefined}
                >
                  {revealSpans(s.spans, s.shownChars).map((sp, i) => (
                    <span key={i}>{sp.text}</span>
                  ))}
                </div>
                {!s.partial && s.romaji && (
                  <div className="cv-romaji">{s.romaji}</div>
                )}
              </div>
              <div>
                <div className="cv-tr-label">{langName(prefs.translateTo)}</div>
                <div className="cv-tr-text">
                  {s.partial ? (
                    <span style={{ color: "var(--cv-faint)" }}>Listening…</span>
                  ) : (
                    (s.translation ?? s.spans.map((sp) => sp.text).join(""))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {replyMode && reply && (
        <>
          <h2 className="cv-section-title">Suggested reply</h2>
          <div className="cv-tr-card">
            <div>
              <div className="cv-tr-label">{langName(theirs)}</div>
              <div className="cv-tr-text">{reply.text}</div>
              <div className="cv-romaji">{reply.romaji}</div>
            </div>
            <div>
              <div className="cv-tr-label">{langName(prefs.translateTo)}</div>
              <div className="cv-tr-text">{reply.translation}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
