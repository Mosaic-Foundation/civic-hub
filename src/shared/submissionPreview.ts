// Submission preview — everything a creator submitted, as a list of
// displayable fields. Shared by the Node backend (review endpoints, via the
// registry) and the React UI (the SubmissionPreview component, and as a
// client-side fallback when a server predates the `submission` payload).
//
// WHY THIS EXISTS (2026-09-02)
// The creator's "My Submissions" page and the admin review page both showed a
// pending submission as title + description and nothing else — a project's
// banner image and sources, a proposal's links and category, a vote's options
// and method were either hidden in a raw JSON toggle or absent. Each page had
// grown a per-type block (conversations only). This module replaces those
// with one rule: a submission preview shows EVERYTHING that was submitted.
//
// UNIVERSAL BY CONSTRUCTION
// `describeSubmissionFields` walks the process `content` block generically —
// `content` is, by convention, what the creator submitted — and turns each
// key into a typed field using key-aware presenters (banner images become an
// image, URL lists become links, `*_ms` numbers become durations, …) with a
// plain-text fallback for anything it has never seen. A process type
// registered tomorrow therefore gets a complete preview with no change here
// and no change in either page. Types whose submission lives on `state`
// rather than `content` (votes, conversations — for historical reasons)
// extend the default through the registry hook `ProcessHandler.
// describeSubmission`; see registry.describeSubmission.
//
// Pure: no Express, no DB, no environment access.

export type SubmissionFieldKind =
  | "image"      // value: { url, alt }
  | "paragraph"  // value: string (multi-line prose)
  | "text"       // value: string (short)
  | "links"      // value: Array<{ label, url }>
  | "list"       // value: string[]
  | "options"    // value: string[] — choices on a ballot
  | "duration"   // value: number (ms) — rendered as "6 weeks"
  | "number"     // value: number
  | "flag"       // value: true — a boolean the reader should know about
  | "sections"   // value: Array<{ heading, body }>
  | "json";      // value: unknown — last resort, never silently dropped

export interface SubmissionField {
  /** Stable key (the content/state key it came from, or a synthetic one). */
  key: string;
  /** Human label, already resolved. */
  label: string;
  kind: SubmissionFieldKind;
  value: unknown;
}

/** The minimum a caller has to hand over. Both a `Process` and a raw
 *  `processes` row satisfy it. */
export interface SubmissionSource {
  type: string;
  title: string;
  description: string;
  content?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Known keys get a considered label; anything else is humanized. */
const LABELS: Record<string, string> = {
  banner_image_url: "Banner image",
  sources: "Sources",
  optional_links: "Links",
  links: "Links",
  seed_statements: "Seed statements",
  options: "Options on the ballot",
  method: "Voting method",
  category: "Category",
  proposal_duration_ms: "Open for",
  voting_duration_ms: "Voting window",
  duration_ms: "Open for",
  participation_threshold: "Participant goal",
  assistant_helped: "Drafted with assistant help",
  core_question: "Core question",
  key_tradeoff: "Key tradeoff",
  sections: "Details",
  considerations: "Considerations",
};

/** Keys that are presentation companions of another key, or internals the
 *  creator did not author — never rendered on their own. */
const SKIP_KEYS = new Set([
  "banner_image_alt", // folded into banner_image_url
  "type",             // state discriminator
]);

export function humanizeKey(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/_ms$/, "").replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/\S+/;

function isUrlish(s: string): boolean {
  return URL_RE.test(s);
}

/** Parse one "Label: https://…" / bare-URL line into a link. Mirrors the UI's
 *  SourceLinks.parseSourceLine so both sides agree on the shape. */
export function parseLinkLine(line: string): { label: string; url: string } | null {
  const m = line.match(URL_RE);
  if (!m || m.index === undefined) return null;
  const url = m[0].replace(/[).,;]+$/, "");
  const label = (line.slice(0, m.index) + line.slice(m.index + m[0].length))
    .replace(/^[\s:—–-]+/, "")
    .replace(/[\s:—–-]+$/, "")
    .trim();
  return { label: label || url, url };
}

/** Coerce the shapes a link list arrives in — string lines, or objects with
 *  url/label — into one shape. Returns null when the value is not link-like. */
function toLinks(value: unknown): Array<{ label: string; url: string }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Array<{ label: string; url: string }> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const parsed = parseLinkLine(item);
      if (!parsed) return null; // a non-URL line: this is a plain list, not links
      out.push(parsed);
    } else if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      const o = item as { url: string; label?: unknown };
      // Some writers store the whole "Label: https://…" line in `url` (the
      // vote draft does); pull the real URL out so the anchor works.
      const parsed = parseLinkLine(o.url);
      if (!parsed) return null;
      const label = typeof o.label === "string" && o.label && o.label !== o.url ? o.label : parsed.label;
      out.push({ url: parsed.url, label });
    } else {
      return null;
    }
  }
  return out;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");
}

function isSectionList(value: unknown): value is Array<{ heading: string; body: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        v && typeof v === "object" &&
        typeof (v as { heading?: unknown }).heading === "string" &&
        typeof (v as { body?: unknown }).body === "string",
    )
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2 weeks" / "1 month" / "6 weeks" / "45 days" — the same vocabulary as the
 *  duration picker, with a days fallback for anything off-menu. */
export function formatDuration(ms: number): string {
  const days = Math.round(ms / DAY_MS);
  if (days === 14) return "2 weeks";
  if (days === 30) return "1 month";
  if (days === 42) return "6 weeks";
  if (days === 60) return "2 months";
  if (days === 90) return "3 months";
  if (days % 7 === 0 && days >= 7) return `${days / 7} week${days === 7 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

const METHOD_LABELS: Record<string, string> = {
  yes_no_unsure: "Yes / No / Unsure",
  approval: "Choose all options you approve of",
};

// ---------------------------------------------------------------------------
// The generic walk
// ---------------------------------------------------------------------------

/**
 * Turn one submitted key/value into a field, or null to skip it (empty
 * values, companions, internals). Order of the checks matters: the key-aware
 * presenters run before the shape-based fallbacks.
 */
export function fieldFor(
  key: string,
  value: unknown,
  siblings: Record<string, unknown>,
): SubmissionField | null {
  if (SKIP_KEYS.has(key)) return null;
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;

  const label = humanizeKey(key);

  // Banner / featured images: the url key carries its alt companion.
  if (/image_url$/.test(key) && typeof value === "string") {
    const altKey = key.replace(/url$/, "alt");
    const alt = typeof siblings[altKey] === "string" ? (siblings[altKey] as string) : "";
    return { key, label, kind: "image", value: { url: value, alt } };
  }

  if (typeof value === "boolean") {
    return value ? { key, label, kind: "flag", value: true } : null;
  }

  if (typeof value === "number") {
    if (/_ms$/.test(key)) return { key, label, kind: "duration", value };
    return { key, label, kind: "number", value };
  }

  if (typeof value === "string") {
    if (key === "method") {
      return { key, label, kind: "text", value: METHOD_LABELS[value] ?? value };
    }
    if (isUrlish(value) && !value.includes("\n")) {
      const parsed = parseLinkLine(value);
      return { key, label, kind: "links", value: parsed ? [parsed] : [] };
    }
    return value.includes("\n") || value.length > 120
      ? { key, label, kind: "paragraph", value }
      : { key, label, kind: "text", value };
  }

  if (key === "options" && isStringList(value)) {
    return { key, label, kind: "options", value };
  }

  const links = toLinks(value);
  if (links) return { key, label, kind: "links", value: links };

  if (isStringList(value)) return { key, label, kind: "list", value };

  if (isSectionList(value)) return { key, label, kind: "sections", value };

  // Never silently drop something the creator submitted.
  return { key, label, kind: "json", value };
}

/** Display order: the picture, the prose, the references, the choices, then
 *  the settings. Within a group, submission order is kept. */
const KIND_ORDER: Record<SubmissionFieldKind, number> = {
  image: 0,
  paragraph: 1,
  text: 1,
  sections: 1,
  links: 2,
  list: 3,
  options: 3,
  duration: 4,
  number: 4,
  flag: 5,
  json: 6,
};

export function orderFields(fields: SubmissionField[]): SubmissionField[] {
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => KIND_ORDER[a.f.kind] - KIND_ORDER[b.f.kind] || a.i - b.i)
    .map(({ f }) => f);
}

/**
 * The default preview: every key in `content`, plus any `extraStateKeys` a
 * process type declares as part of its submission (see the registry hook).
 * Title and description are NOT included — every page already renders those
 * as the heading and body; this list is what sits beneath them.
 */
export function describeSubmissionFields(
  source: SubmissionSource,
  extraStateKeys: string[] = [],
): SubmissionField[] {
  const content = (source.content ?? {}) as Record<string, unknown>;
  const state = (source.state ?? {}) as Record<string, unknown>;
  const fields: SubmissionField[] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(content)) {
    const f = fieldFor(key, value, content);
    if (f) { fields.push(f); seen.add(f.key); }
  }
  for (const key of extraStateKeys) {
    if (seen.has(key)) continue;
    // Dotted keys reach into nested state (e.g. "config.voting_duration_ms").
    const value = key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), state);
    const leaf = key.split(".").pop() as string;
    const f = fieldFor(leaf, value, state);
    if (f) { fields.push({ ...f, key }); seen.add(key); }
  }
  return orderFields(fields);
}
