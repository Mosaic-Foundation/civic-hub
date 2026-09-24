// civic.news_sync — Claude title paraphrase
//
// When an RSS item has no <description>, we ask Claude to write a
// single short sentence that PARAPHRASES the title (and includes the
// event date when available). The prompt is locked tight to keep the
// model from inventing specifics — civic content shouldn't carry
// hallucinated details about times, locations, departments, or
// agendas.
//
// Output is constrained to one sentence ≤ 200 chars and is captured
// once at ingest. We never re-run paraphrase on the same row.

import type { CallClaudeFn } from "../civic.meeting_summary/index.js";

export interface ParaphraseInput {
  /** The announcement title from the RSS <title> element. */
  title: string;
  /**
   * Event date extracted from the title or URL slug, when present.
   * ISO 8601 (YYYY-MM-DD). Null when no date could be confidently
   * extracted; in that case the paraphrase doesn't reference any date.
   */
  event_date: string | null;
}

/**
 * The hub's own names, for the worked examples in the prompt.
 *
 * The examples used to be Floyd's posts verbatim. They are templated now, so
 * Floyd's prompt reads exactly as it did and another hub's examples name its
 * own government — a model shown "Floyd County is accepting bids" while
 * paraphrasing a town's posts is being taught the wrong place.
 */
export interface ParaphrasePlace {
  /** The hub's place, e.g. "Floyd County" — `{PLACE}`. Null for none. */
  place: string | null;
  /** `copy.governing_body_name`, e.g. "Town Council". Null when unset. */
  governing_body: string | null;
}

export interface ParaphraseDeps {
  callClaude: CallClaudeFn;
  /** Anthropic model identifier (defaults to the hub's DEFAULT_MODEL). */
  model: string;
  /** The hub's names for the prompt's examples. */
  names: ParaphrasePlace;
}

/**
 * Build the strict-paraphrase prompt. Exposed so tests / evals can
 * snapshot it; the controller calls `paraphraseTitle` instead.
 */
export function buildParaphrasePrompt(
  input: ParaphraseInput,
  names: ParaphrasePlace = { place: null, governing_body: null },
): string {
  const dateHuman = input.event_date
    ? formatDateHuman(input.event_date)
    : "(none)";

  // Each example needs a place and a body to be an example of anything. A hub
  // with neither gets neutral stand-ins rather than somebody else's.
  const place = names.place?.trim() || "";
  const body = names.governing_body?.trim() || "Council";
  const placeOrGovernment = place || "The local government";
  const building = place ? `${place} Government Building` : "Government Building";
  const deptRule = place
    ? `If the title says "${place}", do not say "${place} DPW" or "${place} Sheriff" unless the title explicitly says so.`
    : `If the title names a government, do not add a department such as "DPW" or "Sheriff" unless the title explicitly says so.`;

  return `You will receive a government announcement title and (optionally) an event date. Write exactly one short factual sentence (no more than 200 characters) that paraphrases the title in plain English.

STRICT RULES — failing any of these makes the output unacceptable:
- Use ONLY facts present in the title and the optional event date.
- Do NOT invent a specific time of day (e.g. "at 7:00 PM").
- Do NOT invent a specific location (street, building, room, address).
- Do NOT invent attendees, speakers, agenda items, vote topics, or content.
- Do NOT invent or expand department names. ${deptRule}
- Do NOT speculate about the post body that you have not seen.
- Do NOT add a year that's not in the input.

FORMATTING RULES:
- A single sentence in plain text.
- No preamble, no quotes, no JSON wrapping, no markdown.
- Output ONLY the sentence.

EXAMPLES:

Title: "Lawn Care Bid"
Event date: (none)
Output: ${placeOrGovernment} is accepting bids for lawn care services.

Title: "${body} Meeting 04/28/2026"
Event date: April 28, 2026
Output: The ${body} will meet on April 28, 2026.

Title: "${building} Door 2 Inaccessible - Elevator Repairs"
Event date: (none)
Output: Door 2 of the ${building} is closed for elevator repairs.

Title: "Bear Activity Notice – Green Boxes Mill Creek Road (North Area)"
Event date: (none)
Output: A notice about bear activity at the Mill Creek Road green boxes in the north area.

Title: "Budget Workshop"
Event date: (none)
Output: A budget workshop has been announced.

NOW PARAPHRASE THIS ITEM:

Title: "${input.title}"
Event date: ${dateHuman}
Output:`;
}

/**
 * Call Claude with the strict-paraphrase prompt and post-process the
 * response. Returns the cleaned single-sentence paraphrase (≤ 200
 * chars). Throws on Claude failure or unparseable output — the
 * caller treats throws as "no paraphrase available" and falls back
 * to an empty body.
 */
export async function paraphraseTitle(
  input: ParaphraseInput,
  deps: ParaphraseDeps,
): Promise<string> {
  const prompt = buildParaphrasePrompt(input, deps.names);

  const { text } = await deps.callClaude({
    model: deps.model,
    userText: prompt,
    // Plenty of headroom for a single sentence; capping at 200 just
    // in case the model spirals into a paragraph.
    maxTokens: 200,
  });

  return cleanParaphrase(text);
}

/**
 * Strip Claude artifacts: leading/trailing whitespace, accidental
 * markdown fences, surrounding quotes, multiple sentences, length
 * blow-out. Returns the first sentence trimmed to <= 200 chars.
 */
export function cleanParaphrase(raw: string): string {
  let s = raw.trim();
  // Strip code fences (```output``` or ```).
  s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  // Strip surrounding quotes (sometimes Claude wraps the answer).
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Take only the first sentence-ending punctuation. Defensive — the
  // prompt requires a single sentence but the model occasionally adds
  // a follow-up.
  const m = s.match(/^[^.!?]+[.!?]/);
  if (m) s = m[0];
  // Hard length cap.
  if (s.length > 200) s = s.slice(0, 197).replace(/[\s,;:]*$/, "") + "…";
  return s.trim();
}

function formatDateHuman(iso: string): string {
  // ISO 8601 date (YYYY-MM-DD). Construct as UTC noon to avoid
  // timezone-edge weirdness, then format US-style. Returns "April 28,
  // 2026" for "2026-04-28".
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
