import { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Cloud,
  Pause,
  Play,
  RotateCcw,
  Pin,
  Sparkles,
  Info,
  MessageCircleQuestionMark,
  PictureInPicture2,
} from "lucide-react";
import { LIVE_TITLE, PINNED, langName } from "../lib/demo";
import { formatClock, inTauri, loadPrefs } from "../lib/runtime";
import { toggleOverlay } from "../lib/overlay";
import {
  revealSpans,
  type LiveAnswer,
  type LiveSegment,
  type SessionState,
} from "../lib/useSession";

type Tab = "assist" | "context";

export default function Live({ session }: { session: SessionState }) {
  const [tab, setTab] = useState<Tab>("assist");
  const [question, setQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefs = loadPrefs();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [
    session.segments.length,
    session.segments[session.segments.length - 1]?.shownChars,
  ]);

  const submit = () => {
    session.ask(question);
    setQuestion("");
    setTab("assist");
  };

  return (
    <div className="cv-live">
      <section className="cv-live-feed">
        <div className="cv-live-bar">
          {session.running ? (
            <span className="cv-dot cv-dot-live" />
          ) : (
            <span className="cv-dot" />
          )}
          <span className="cv-live-title">{LIVE_TITLE}</span>
          <span className="cv-timer">{formatClock(session.elapsed)}</span>
          <span className="cv-tag">Me + Them</span>
          <span style={{ flex: 1 }} />
          {inTauri && (
            <button
              type="button"
              className="cv-btn cv-btn-sm"
              onClick={toggleOverlay}
              title="Floating panel only you can see"
            >
              <PictureInPicture2 size={13} /> Overlay
            </button>
          )}
          {session.running ? (
            <button
              type="button"
              className="cv-btn cv-btn-sm"
              onClick={session.pause}
            >
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button
              type="button"
              className="cv-btn cv-btn-sm cv-btn-primary"
              onClick={session.start}
            >
              <Play size={13} /> {session.elapsed ? "Resume" : "Start"}
            </button>
          )}
          <button
            type="button"
            className="cv-btn cv-btn-sm"
            onClick={session.reset}
            title="Restart"
            disabled={!session.elapsed}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="cv-banner">
          <Info size={13} />
          Demo playback. Live mic and system audio capture land in the next
          build.
        </div>

        <div className="cv-live-scroll" ref={scrollRef}>
          {session.segments.length === 0 ? (
            <div className="cv-empty">
              <h3>Ready when you are</h3>
              <p>
                Cravin listens to you and the other side as two streams,
                translates what isn't in your language, and suggests answers
                when they ask something.
              </p>
              {prefs.consentReminder && (
                <p style={{ fontSize: 12 }}>
                  Let everyone on the call know you're transcribing.
                </p>
              )}
            </div>
          ) : (
            session.segments.map((s) => (
              <SegmentRow
                key={s.id}
                seg={s}
                showTranslation={prefs.liveTranslate}
              />
            ))
          )}
        </div>
      </section>

      <aside className="cv-assist">
        <div className="cv-tabs">
          <button
            type="button"
            className="cv-chip"
            aria-pressed={tab === "assist"}
            onClick={() => setTab("assist")}
          >
            Assist
          </button>
          <button
            type="button"
            className="cv-chip"
            aria-pressed={tab === "context"}
            onClick={() => setTab("context")}
          >
            Context
          </button>
        </div>
        <div className="cv-assist-body">
          {tab === "assist" ? (
            session.answers.length === 0 ? (
              <div className="cv-empty" style={{ fontSize: 12.5 }}>
                Suggestions show up here when the other side finishes a
                question.
              </div>
            ) : (
              session.answers.map((a) => <AnswerCard key={a.id} answer={a} />)
            )
          ) : (
            <ContextPanel summary={session.summary} />
          )}
        </div>
        <form
          className="cv-ask"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
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
      </aside>
    </div>
  );
}

function SegmentRow({
  seg,
  showTranslation,
}: {
  seg: LiveSegment;
  showTranslation: boolean;
}) {
  const spans = revealSpans(seg.spans, seg.shownChars);
  const foreign = seg.spans.some((sp) => sp.lang !== "en");
  return (
    <div className="cv-seg">
      <div className="cv-seg-who" data-side={seg.side}>
        {seg.side === "me" ? "Me" : "Them"}
        <small>{formatClock(seg.at)}</small>
      </div>
      <div>
        <div className="cv-seg-text" data-partial={seg.partial}>
          {spans.map((sp, i) => (
            <span
              key={i}
              className={sp.lang !== "en" ? "cv-span-foreign" : undefined}
              title={langName(sp.lang)}
            >
              {sp.text}
            </span>
          ))}
          {seg.partial && <span className="cv-caret" />}
        </div>
        {showTranslation && foreign && !seg.partial && seg.translation && (
          <div className="cv-seg-tr">{seg.translation}</div>
        )}
      </div>
    </div>
  );
}

function AnswerCard({ answer }: { answer: LiveAnswer }) {
  const streaming = answer.shown < answer.text.length;
  return (
    <div className="cv-note">
      <div className="cv-note-head">
        {answer.question ? (
          <MessageCircleQuestionMark size={12} />
        ) : (
          <Sparkles size={12} />
        )}
        <span>{answer.question ? "You asked" : "Suggested answer"}</span>
        <span style={{ flex: 1 }} />
        <span className="cv-tag">
          {answer.tier === "local" ? <Cpu size={11} /> : <Cloud size={11} />}
          {answer.model}
        </span>
      </div>
      {answer.question && (
        <p style={{ fontWeight: 500, marginBottom: 6 }}>{answer.question}</p>
      )}
      <p>
        {answer.text.slice(0, answer.shown)}
        {streaming && <span className="cv-caret" />}
      </p>
      {answer.reply && !streaming && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--cv-border)",
          }}
        >
          <div className="cv-note-head">Reply in Japanese</div>
          <p>{answer.reply.text}</p>
          <div className="cv-romaji">{answer.reply.romaji}</div>
        </div>
      )}
    </div>
  );
}

function ContextPanel({ summary }: { summary: string[] }) {
  return (
    <>
      <div className="cv-note">
        <div className="cv-note-head">
          <Pin size={12} /> Pinned
        </div>
        <ul>
          {PINNED.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <div className="cv-note">
        <div className="cv-note-head">Running summary</div>
        {summary.length ? (
          <ul>
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--cv-muted)" }}>
            Fills in as the meeting goes.
          </p>
        )}
      </div>
      <div className="cv-note">
        <div className="cv-note-head">Screen</div>
        <p style={{ color: "var(--cv-muted)" }}>
          Screen text capture is off in this build.
        </p>
      </div>
    </>
  );
}
