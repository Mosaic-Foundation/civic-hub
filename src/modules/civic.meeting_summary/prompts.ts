// civic.meeting_summary module — Claude prompt templates
//
// Two prompts, both prepending the admin's extraction_instructions in a
// clearly delimited block so the admin can steer behavior without
// round-tripping through engineering. Exported as string builders so
// evals / tests can diff them.

const DEFAULT_INSTRUCTIONS = `These are official government meeting records. Produce accurate, neutral summaries. Do not speculate. When in doubt about a fact, say the minutes or transcript are unclear rather than inventing detail.`;

function instructionsBlock(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const body = trimmed.length > 0 ? trimmed : DEFAULT_INSTRUCTIONS;
  return `<admin_instructions>\n${body}\n</admin_instructions>`;
}

/**
 * Prompt for the minutes-page discovery leg. The connector passes the
 * trimmed HTML of a jurisdiction's agendas-and-minutes listing page; we
 * ask Claude to enumerate every meeting entry with its PDF + YouTube
 * URLs. The response MUST be a JSON array — Claude is told to emit
 * nothing else.
 */
export function buildDiscoveryPrompt(input: {
  extraction_instructions: string;
  trimmed_html: string;
  source_url: string;
}): string {
  return `You are extracting a structured list of government meetings from an agendas-and-minutes page.

CRITICAL CONSTRAINTS (apply before anything else):
- Produce AT MOST 50 entries in the output array. If the page contains more, return only the most recent 50.
- Honor the date and content restrictions stated in <admin_instructions> below. If the admin's instructions say to exclude meetings before a date, do not include them — not as placeholders, not as null entries, not at all.
- Output nothing but the JSON array. No commentary, no preamble, no "Here are the entries:".

${instructionsBlock(input.extraction_instructions)}

<source_url>${input.source_url}</source_url>

<trimmed_html>
${input.trimmed_html}
</trimmed_html>

For each meeting entry visible on the page, extract:
- meeting_title: short human-readable name (e.g. "Board of Supervisors Regular Meeting", "Budget Workshop"). Do NOT include the date in this field.
- meeting_date: ISO 8601 date (YYYY-MM-DD). Infer year if missing but prefer pages where the year is explicit.
- source_minutes_url: the full https:// URL of the minutes PDF for that meeting, or null if no minutes PDF is linked. Must end in .pdf. Look for links labeled "Minutes" — do NOT confuse "Agenda" links with "Minutes" links.
- source_agenda_url: the full https:// URL of the agenda PDF for that meeting, or null if no agenda PDF is linked. Must end in .pdf. Look for links labeled "Agenda".
- source_video_url: the full https:// URL of the primary YouTube recording for that meeting, or null if no recording is available. If multiple recordings exist for the same meeting (e.g. "Video Recording 1" and "Video Recording 2"), this is the FIRST one.
- additional_video_urls: array of any additional YouTube URLs for the same meeting (segment 2, continuation, retry after stream drop). Empty array if only one recording exists.
- source_id: a stable dedupe key. Use the source_minutes_url when available (the PDF URL). For meetings with no minutes, use the format "YYYY-MM-DD:<meeting_title>" (e.g. "2026-06-09:Board of Supervisors Regular Meeting").

IMPORTANT: Include meetings even if they only have an agenda and/or video but no minutes. A meeting entry is valid as long as it has at least one PDF link (minutes or agenda) OR a video recording.

Ignore anything that is not a specific meeting entry (site chrome, navigation, footer links, general "how to attend" instructions, unrelated pages).

Return a JSON array of entries. If the page contains no meeting entries, return [].

STRICT JSON RULES — your response must be machine-parseable:
- Emit ONLY the JSON array. No prose. No markdown fences. No explanation before or after.
- Every string value MUST be a single-line string — no literal newlines inside strings. Use a space instead if needed.
- Every double-quote character that appears inside a string value MUST be escaped as \\" .
- Every backslash inside a string value MUST be escaped as \\\\ .
- No trailing commas after the last element of an array or object.
- Do NOT include any keys not listed above.

Your entire response will be fed to JSON.parse(). If it fails to parse, the run fails.`;
}

/**
 * Prompt for the per-meeting summarization leg. Takes the PDF (passed
 * as a native document content block at the API layer) and the YouTube
 * transcript (stringified with timestamps) and asks Claude for a list
 * of topic blocks. The response MUST be a JSON object with a `blocks`
 * array.
 *
 * When there is no transcript (video unavailable), the caller passes
 * an empty transcript string and sets `has_video: false` — this prompt
 * explicitly instructs Claude to leave start_time_seconds null in that
 * case.
 */
export function buildSummarizationPrompt(input: {
  extraction_instructions: string;
  meeting_title: string;
  meeting_date: string;
  transcript_text: string;
  has_video: boolean;
  source_type: "minutes" | "agenda" | "recording";
}): string {
  const isAgenda = input.source_type === "agenda";
  const isRecordingOnly = input.source_type === "recording";
  const documentName = isAgenda ? "agenda" : "minutes";

  const videoGuidance = input.has_video
    ? `For each block, set start_time_seconds to the transcript timestamp where that topic begins (an integer number of seconds from the start of the video). Use ONLY timestamps you can ground in a specific transcript line. If you cannot find the topic in the transcript, set start_time_seconds to null — do NOT default to 0 and do NOT guess.`
    : `This meeting has NO video recording. Set start_time_seconds to null on every block. Summarize from the ${documentName} document only.`;

  const transcriptBlock = input.has_video
    ? `<transcript>\n${input.transcript_text}\n</transcript>`
    : `<transcript>(no video recording for this meeting)</transcript>`;

  const recordingGuidance = `There is NO minutes document and NO agenda document for this meeting — the video transcript is your ONLY source. It is an automatic (speech-to-text) transcript of the meeting recording, so expect misheard names, garbled proper nouns, and missing punctuation.

Work only from what the transcript actually supports:
- Do NOT infer agenda items that were never spoken about.
- When a name, dollar figure, vote count, or ordinance number is unclear in the transcript, say so in plain language ("the transcript is unclear on the exact figure") rather than guessing a value.
- Prefer describing what was discussed and decided over reconstructing formal procedure.
- Public comment and citizen concerns are in scope — they are often the most useful part of the record for residents and appear nowhere else.`;

  const sourceGuidance = isRecordingOnly
    ? recordingGuidance
    : isAgenda
    ? `The attached PDF is the meeting AGENDA (not official minutes). The agenda only lists planned topics — it does NOT record what was actually discussed or decided.

${input.has_video ? `The video transcript is your PRIMARY source for what happened in this meeting. Use it to determine what was discussed, what decisions were made, and what actions were taken. The agenda serves only as a topic guide — the transcript tells you what actually occurred, including any topics that came up during public comment or discussion that were NOT on the agenda.

IMPORTANT: Do not limit yourself to agenda items. If the transcript shows substantive discussion on a topic not listed in the agenda (e.g. public comments, ad-hoc discussions, citizen concerns), include it as a block.` : `Without minutes or a video transcript, summarize the planned agenda items. Note that this is a summary of what was planned, not what actually occurred.`}`
    : `The minutes document is attached as a PDF. Use it as the authoritative record of what was discussed and what was decided.`;

  return `You are summarizing a government meeting into a short list of topic blocks for citizens to read.

${instructionsBlock(input.extraction_instructions)}

<meeting>
  <title>${input.meeting_title}</title>
  <date>${input.meeting_date}</date>
</meeting>

${sourceGuidance}

${transcriptBlock}

Produce a chronological list of topic blocks. Each block covers one coherent agenda item or topic of discussion. Keep summaries short and plain-spoken — residents are the audience, not lawyers.

For each block, produce:
- topic_title: a short phrase (under 12 words) naming the topic.
- topic_summary: 1–4 sentences of plain-language summary. Neutral tone. No speculation. If the ${isAgenda || isRecordingOnly ? "transcript is" : "minutes are"} unclear, say so.
- start_time_seconds: see below.
- action_taken: a single short sentence describing any concrete action, motion, vote, or decision from this block. Null if the block is discussion only.

${videoGuidance}

Aim for 4–12 blocks per meeting. Skip procedural micro-items (call to order, roll call, adjournment, etc.) unless they contain substantive content.

Return a JSON object of the form:
{
  "blocks": [
    {
      "topic_title": "...",
      "topic_summary": "...",
      "start_time_seconds": 123,
      "action_taken": "..." | null
    }
  ]
}

Emit ONLY the JSON object — no prose, no markdown fences, no explanation. Your entire response MUST parse as JSON.`;
}

/** Exposed so callers can snapshot the admin instructions used for a run. */
export function resolveEffectiveInstructions(raw: string): string {
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_INSTRUCTIONS;
}
