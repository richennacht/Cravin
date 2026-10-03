import { useState } from "react";
import { Plus } from "lucide-react";
import { SESSIONS, type Session } from "../lib/demo";

const FILTERS = ["All", "Calls", "Translation", "Team"] as const;
type Filter = (typeof FILTERS)[number];

export default function Home({
  onOpenLive,
  onNewSession,
}: {
  onOpenLive: () => void;
  onNewSession: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const sessions = SESSIONS.filter(
    (s) => filter === "All" || s.kind === filter,
  );

  return (
    <div className="cv-page">
      <header className="cv-page-head">
        <div>
          <h1 className="cv-title">Meetings</h1>
          <p className="cv-subtitle">
            Everything you heard, said and saw, kept on this machine.
          </p>
        </div>
        <button
          type="button"
          className="cv-btn cv-btn-primary"
          onClick={onNewSession}
        >
          <Plus size={14} /> New session
        </button>
      </header>

      <div className="cv-chips" role="group" aria-label="Filter meetings">
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

      <div className="cv-grid">
        <button type="button" className="cv-card" onClick={onNewSession}>
          <div className="cv-card-thumb cv-card-thumb-new">
            <Plus size={20} />
            <span>Start listening</span>
          </div>
          <div className="cv-card-meta">
            <span className="cv-card-title">New session</span>
          </div>
        </button>
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s} onOpen={onOpenLive} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="cv-card" onClick={onOpen}>
      <div className="cv-card-thumb">
        {session.preview.map((line, i) => (
          <div
            key={i}
            className={`cv-bubble ${line.side === "me" ? "cv-bubble-me" : ""}`}
          >
            {line.text}
          </div>
        ))}
      </div>
      <div className="cv-card-meta">
        <span style={{ display: "flex" }}>
          {session.people.map((p, i) => (
            <span
              key={p.initials}
              className="cv-avatar"
              style={{ background: p.color, marginInlineStart: i ? -5 : 0 }}
            >
              {p.initials}
            </span>
          ))}
        </span>
        <span className="cv-card-title">{session.title}</span>
        <span className="cv-card-sub">{session.minutes} min</span>
      </div>
      <div className="cv-card-meta" style={{ marginTop: -4 }}>
        <span className="cv-row-desc">{session.date}</span>
        {session.langs.map((l) => (
          <span key={l} className="cv-tag">
            {l}
          </span>
        ))}
      </div>
    </button>
  );
}
