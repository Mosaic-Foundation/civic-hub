// Limits on the paid AI calls a hub's people can make (Audit 2, A6; numbers
// decided by Adam 2026-10-11). Shared by the server, which enforces them, and
// the console, which shows and edits a hub's overrides. Pure.
//
// What is limited: the drafting assistant's chat turns and "Get suggestions"
// (the `chat` calls), and the Code of Conduct check (`review`). Scheduled jobs
// (meeting summaries, news) are the platform's and are not counted.
//
// Where the numbers live: the defaults below, by the hub's mode, with any
// override the operator sets in the console (hub_settings `limits.ai`, a JSON
// object of the fields to change). A hub's own admins cannot write that key:
// it is in no Settings section.
//
// Cost reasoning (claude-sonnet-4-6, $3 / $15 per million tokens in / out):
// a turn is mostly input, roughly 8–15k tokens with the hub's Code of Conduct
// and guide in the system prompt, more with web search. 1.5M tokens a day is
// about 100–180 turns and $5–8 at most per hub; a demo's 300k is about $1.

export interface AiLimits {
  /** Chat turns and suggestions per person per hour. */
  user_per_hour: number;
  /** Chat turns and suggestions per person per day. */
  user_per_day: number;
  /** Code of Conduct checks per person per hour. */
  review_per_hour: number;
  /** Chat turns and suggestions per hub per hour, everyone together. */
  hub_per_hour: number;
  /** Tokens (in + out) per hub per rolling 24 hours, all AI calls residents make. */
  daily_tokens: number;
  /** Longest message a person may send the assistant, in characters. */
  max_message_chars: number;
  /** How many earlier messages (both sides) are sent with each turn. */
  history_messages: number;
  /** May the assistant search the web? */
  web_search: boolean;
}

const BASE: AiLimits = {
  user_per_hour: 20,
  user_per_day: 60,
  review_per_hour: 30,
  hub_per_hour: 200,
  daily_tokens: 1_500_000,
  max_message_chars: 4000,
  history_messages: 12,
  web_search: true,
};

/** A demo hub is anyone's to try: a smaller budget, and no web search. */
const DEMO: Partial<AiLimits> = { daily_tokens: 300_000, web_search: false };

/** What each field may be set to, and its label in the console. */
export const AI_LIMIT_FIELDS: ReadonlyArray<{
  key: keyof AiLimits;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "user_per_hour", label: "Assistant turns per person per hour", min: 0, max: 500 },
  { key: "user_per_day", label: "Assistant turns per person per day", min: 0, max: 5000 },
  { key: "review_per_hour", label: "Code of Conduct checks per person per hour", min: 1, max: 500 },
  { key: "hub_per_hour", label: "Assistant turns per hub per hour", min: 0, max: 20000 },
  { key: "daily_tokens", label: "Tokens per hub per day", min: 0, max: 100_000_000 },
  { key: "max_message_chars", label: "Longest message (characters)", min: 200, max: 20000 },
  { key: "history_messages", label: "Earlier messages sent with each turn", min: 2, max: 100 },
];

export function aiLimitDefaults(mode: string | null | undefined): AiLimits {
  return mode === "demo" ? { ...BASE, ...DEMO } : { ...BASE };
}

/**
 * The overrides stored in `limits.ai`, keeping only known fields with valid
 * values. A corrupt row means no overrides, never no limits.
 */
export function parseAiLimitOverrides(raw: string | null | undefined): Partial<AiLimits> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const input = parsed as Record<string, unknown>;
  const out: Partial<AiLimits> = {};
  for (const f of AI_LIMIT_FIELDS) {
    const v = input[f.key];
    if (typeof v === "number" && Number.isInteger(v) && v >= f.min && v <= f.max) {
      (out as Record<string, number>)[f.key] = v;
    }
  }
  if (typeof input.web_search === "boolean") out.web_search = input.web_search;
  return out;
}

/**
 * Check an operator's overrides before they are stored. Returns the problem
 * in words, or null. Only the fields given are checked; `null` for a field
 * means "back to the default" and is allowed.
 */
export function aiLimitOverridesProblem(input: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(input)) {
    if (v === null) continue;
    if (k === "web_search") {
      if (typeof v !== "boolean") return "Web search is on or off.";
      continue;
    }
    const f = AI_LIMIT_FIELDS.find((x) => x.key === k);
    if (!f) return `"${k}" is not an AI limit.`;
    if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) {
      return `${f.label} must be a whole number from ${f.min} to ${f.max.toLocaleString("en-US")}.`;
    }
  }
  return null;
}

export function effectiveAiLimits(mode: string | null | undefined, raw: string | null | undefined): AiLimits {
  return { ...aiLimitDefaults(mode), ...parseAiLimitOverrides(raw) };
}
