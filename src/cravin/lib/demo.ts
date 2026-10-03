// Demo content for the UI preview. The live engine (dual capture, turn
// detection, routing) replaces this; the shapes match what it will emit.

export type Side = "me" | "them";

export type Span = { lang: string; text: string };

export type Segment = {
  id: string;
  side: Side;
  at: number; // seconds from session start
  spans: Span[];
  translation?: string; // into the user's language, when any span is foreign
  romaji?: string;
  question?: boolean; // text gate decided this deserves an answer
};

export type Suggestion = {
  forSegment: string;
  tier: "local" | "api";
  model: string;
  text: string;
  reply?: { text: string; romaji: string; translation: string };
};

export type Session = {
  id: string;
  title: string;
  kind: "Calls" | "Translation" | "Team";
  date: string;
  minutes: number;
  langs: string[];
  people: { initials: string; color: string }[];
  preview: { side: Side; text: string }[];
};

export const SESSIONS: Session[] = [
  {
    id: "s1",
    title: "Acme renewal call",
    kind: "Calls",
    date: "Today",
    minutes: 32,
    langs: ["EN"],
    people: [{ initials: "JM", color: "#e5735c" }],
    preview: [
      { side: "them", text: "What's your pricing for 50 seats?" },
      { side: "me", text: "Above 25 seats you're on the team tier." },
    ],
  },
  {
    id: "s2",
    title: "Tanaka-san weekly sync",
    kind: "Translation",
    date: "Yesterday",
    minutes: 18,
    langs: ["JA", "EN"],
    people: [{ initials: "KT", color: "#5c7ce5" }],
    preview: [
      { side: "them", text: "納期は来週の金曜日で大丈夫ですか？" },
      { side: "me", text: "Yes, Friday works for us." },
    ],
  },
  {
    id: "s3",
    title: "Product standup",
    kind: "Team",
    date: "Oct 1",
    minutes: 24,
    langs: ["EN"],
    people: [
      { initials: "AL", color: "#3fa877" },
      { initials: "RS", color: "#b866d9" },
    ],
    preview: [
      { side: "them", text: "Can we move the beta to the 14th?" },
      { side: "me", text: "Only if onboarding ships first." },
    ],
  },
  {
    id: "s4",
    title: "Kickoff with Banco Norte",
    kind: "Translation",
    date: "Sep 30",
    minutes: 27,
    langs: ["ES", "EN"],
    people: [{ initials: "LG", color: "#d9a03f" }],
    preview: [
      { side: "them", text: "¿Cuándo podemos empezar la integración?" },
      { side: "me", text: "We can start the week of the 12th." },
    ],
  },
  {
    id: "s5",
    title: "Design review, Lumen",
    kind: "Calls",
    date: "Sep 29",
    minutes: 41,
    langs: ["EN"],
    people: [{ initials: "PD", color: "#4cb3c4" }],
    preview: [
      { side: "them", text: "The empty states feel unfinished." },
      { side: "me", text: "Agreed, we'll add illustrations." },
    ],
  },
];

export const LIVE_TITLE = "Delivery check-in with Kenji";

export const PINNED = [
  "Team tier: $18 per seat per month above 25 seats, $15 billed annually",
  "Staging environment ready Wednesday, Oct 7",
  "Kenji Tanaka, Head of Operations, Osaka office",
];

export const SCRIPT: Segment[] = [
  {
    id: "g1",
    side: "them",
    at: 2,
    spans: [
      {
        lang: "en",
        text: "Thanks for making time today. Can you hear me okay?",
      },
    ],
  },
  {
    id: "g2",
    side: "me",
    at: 6,
    spans: [{ lang: "en", text: "Loud and clear. Thanks for joining, Kenji." }],
  },
  {
    id: "g3",
    side: "them",
    at: 10,
    spans: [
      { lang: "en", text: "So the rollout plan looks good, but " },
      { lang: "ja", text: "納期は来週の金曜日で大丈夫ですか？" },
    ],
    translation:
      "So the rollout plan looks good, but is next Friday okay for delivery?",
    romaji: "Nōki wa raishū no kin'yōbi de daijōbu desu ka?",
    question: true,
  },
  {
    id: "g4",
    side: "me",
    at: 18,
    spans: [
      {
        lang: "en",
        text: "Yes, Friday works. Staging will be ready by Wednesday.",
      },
    ],
  },
  {
    id: "g5",
    side: "them",
    at: 23,
    spans: [
      { lang: "en", text: "Great. And what's your pricing for fifty seats?" },
    ],
    question: true,
  },
  {
    id: "g6",
    side: "me",
    at: 30,
    spans: [
      {
        lang: "en",
        text: "For fifty seats you'd be on the team tier, eighteen dollars a seat.",
      },
    ],
  },
  {
    id: "g7",
    side: "them",
    at: 36,
    spans: [
      { lang: "ja", text: "わかりました。" },
      {
        lang: "en",
        text: "Let me check with procurement and get back to you.",
      },
    ],
    translation:
      "Understood. Let me check with procurement and get back to you.",
    romaji: "Wakarimashita.",
  },
];

export const SUGGESTIONS: Suggestion[] = [
  {
    forSegment: "g3",
    tier: "local",
    model: "Qwen3 4B",
    text: "Yes, next Friday works. Staging is ready Wednesday, so Kenji gets two days to review.",
    reply: {
      text: "はい、来週の金曜日で大丈夫です。水曜日にステージングを用意します。",
      romaji:
        "Hai, raishū no kin'yōbi de daijōbu desu. Suiyōbi ni sutējingu o yōi shimasu.",
      translation:
        "Yes, next Friday works. We'll have staging ready on Wednesday.",
    },
  },
  {
    forSegment: "g5",
    tier: "local",
    model: "Qwen3 4B",
    text: "50 seats lands on the team tier: $18 per seat per month, or $15 billed annually. That's $900 a month, or $9,000 a year.",
  },
];

export const SUMMARY_AFTER: Record<string, string> = {
  g3: "Kenji is happy with the rollout plan and asked to confirm next Friday for delivery.",
  g4: "Delivery confirmed for next Friday, staging ready Wednesday.",
  g5: "Kenji asked about pricing for 50 seats.",
  g7: "Kenji will check pricing with procurement and follow up.",
};

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

export const langName = (code: string) => LANG_NAMES[code] ?? code;

export const TRANSLATE_LANGS = Object.keys(LANG_NAMES);

/** Canned answers for the preview's ask box, picked by keyword. */
export const answerFor = (
  question: string,
): { tier: "local" | "api"; model: string; text: string } => {
  const q = question.toLowerCase();
  const deep = /(explain|debug|design|compare|derive|why)/.test(q);
  const tier = deep ? "api" : "local";
  const model = deep ? "Claude Sonnet 5.5" : "Qwen3 4B";
  if (/(pric|seat|cost|\$)/.test(q))
    return {
      tier,
      model,
      text: "Team tier is $18 per seat per month above 25 seats, $15 if billed annually. For 50 seats that's $900 a month.",
    };
  if (/(deadline|friday|deliver|date|when)/.test(q))
    return {
      tier,
      model,
      text: "Delivery is next Friday. You told Kenji staging will be ready Wednesday, Oct 7.",
    };
  if (/(summar|recap|so far)/.test(q))
    return {
      tier,
      model,
      text: "Kenji approved the rollout plan, delivery is set for next Friday, and he's taking 50-seat pricing to procurement.",
    };
  return {
    tier,
    model,
    text: "Nothing in this meeting covers that yet. Try asking about delivery, pricing, or a recap.",
  };
};
