import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SCRIPT,
  SUGGESTIONS,
  SUMMARY_AFTER,
  answerFor,
  type Segment,
  type Suggestion,
} from "./demo";

const SPEAK_RATE = 0.045; // seconds per character while a turn is "spoken"
const STREAM_RATE = 70; // characters per second for streamed answers
const TURN_GAP = 0.6; // seconds of silence before turn detection finalizes

export type LiveSegment = Segment & {
  partial: boolean;
  shownChars: number; // characters revealed so far across all spans
  totalChars: number;
};

export type LiveAnswer = {
  id: string;
  question?: string; // set when the user asked, empty for auto-suggest
  tier: "local" | "api";
  model: string;
  text: string;
  shown: number;
  reply?: Suggestion["reply"];
};

type Ask = { id: string; question: string; at: number };

const segLength = (s: Segment) =>
  s.spans.reduce((n, sp) => n + sp.text.length, 0);
const finalAt = (s: Segment) => s.at + segLength(s) * SPEAK_RATE + TURN_GAP;

/**
 * Plays the demo meeting on a clock. Everything is derived from `elapsed`,
 * so pausing, resuming and switching pages keep a consistent picture.
 */
export function useSession() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [asks, setAsks] = useState<Ask[]>([]);
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;

  useEffect(() => {
    if (!running) return;
    const started = performance.now() - elapsedRef.current * 1000;
    const id = window.setInterval(() => {
      setElapsed((performance.now() - started) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  const segments: LiveSegment[] = useMemo(
    () =>
      SCRIPT.filter((s) => s.at <= elapsed).map((s) => {
        const totalChars = segLength(s);
        const shownChars = Math.min(
          totalChars,
          Math.floor((elapsed - s.at) / SPEAK_RATE),
        );
        return {
          ...s,
          totalChars,
          shownChars,
          partial: elapsed < finalAt(s),
        };
      }),
    [elapsed],
  );

  const answers: LiveAnswer[] = useMemo(() => {
    const out: (LiveAnswer & { start: number })[] = [];
    for (const sug of SUGGESTIONS) {
      const seg = SCRIPT.find((s) => s.id === sug.forSegment);
      if (!seg) continue;
      const start = finalAt(seg) + 0.3;
      if (elapsed < start) continue;
      out.push({
        id: sug.forSegment,
        tier: sug.tier,
        model: sug.model,
        text: sug.text,
        reply: sug.reply,
        shown: Math.floor((elapsed - start) * STREAM_RATE),
        start,
      });
    }
    for (const ask of asks) {
      const a = answerFor(ask.question);
      const start = ask.at + 0.4;
      out.push({
        id: ask.id,
        question: ask.question,
        ...a,
        shown: Math.max(0, Math.floor((elapsed - start) * STREAM_RATE)),
        start,
      });
    }
    return out.sort((a, b) => b.start - a.start);
  }, [elapsed, asks]);

  const summary = useMemo(
    () =>
      SCRIPT.filter((s) => SUMMARY_AFTER[s.id] && finalAt(s) <= elapsed).map(
        (s) => SUMMARY_AFTER[s.id],
      ),
    [elapsed],
  );

  const ask = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      setAsks((prev) => [
        ...prev,
        { id: `ask-${prev.length}`, question: q, at: elapsed },
      ]);
      setRunning(true);
    },
    [elapsed],
  );

  const reset = useCallback(() => {
    setRunning(false);
    setElapsed(0);
    setAsks([]);
  }, []);

  return {
    running,
    elapsed,
    segments,
    answers,
    summary,
    start: () => setRunning(true),
    pause: () => setRunning(false),
    reset,
    ask,
  };
}

export type SessionState = ReturnType<typeof useSession>;

/** Reveal the first `chars` characters across spans, keeping span boundaries. */
export const revealSpans = (spans: Segment["spans"], chars: number) => {
  const out: Segment["spans"] = [];
  let left = chars;
  for (const sp of spans) {
    if (left <= 0) break;
    out.push({ ...sp, text: sp.text.slice(0, left) });
    left -= sp.text.length;
  }
  return out;
};
