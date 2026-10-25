// feedActivity.ts — THE single source of truth for "what is feed-worthy".
//
// Phase 3 of the 2026-06-25 consistency audit (decisions/
// audit-2026-06-25-process-and-feed-consistency.md §2). Before this module,
// the feed-worthiness decision was forked across FOUR drifting copies:
//   1. ui/src/components/Feed.tsx        (kindFromEvent — the inclusion gate)
//   2. ui/src/components/FeedPost.tsx    (eventToPost — the renderer)
//   3. ui/src/components/FeedFilter.tsx  (buildFilterPredicate — the ?type= filter)
//   4. src/modules/civic.digest/filter.ts (isDigestRenderable + classifyItemKind)
// They could not be diffed mechanically (a flat Set vs a data-shape switch)
// and had already drifted — generic "Activity" cards, a wordcloud mislabeled
// as a vote in the digest, proposals/projects/conversations visible in-app but
// absent from email. This module collapses all four into ONE classifier.
//
// SHARED ACROSS BOTH RUNTIMES — consumed by:
//   - the Vite frontend (Feed / FeedPost / FeedFilter), and
//   - the Node backend (civic.digest filter + service).
// It MUST therefore stay framework-agnostic and free of server code: its one
// import is the process manifests (plain data, src/shared/processManifests.ts;
// eslint keeps it to that).
// Do NOT fork this logic back into the consumers — that drift is the bug this
// module exists to kill. Frontend imports it by relative path; the backend
// gets it via `src/**/*`.
//
// DESIGN — an explicit ALLOWLIST (default-CLOSED). Only event types named here
// produce a feed/digest card; everything else returns null. This is the seam
// for future admin-configurable feed-worthiness (good hardcoded defaults now;
// a config layer can later override the allowlist) and the reason adding
// `data.process.type` to non-feed-worthy emitters (comment_added,
// vote_submitted, moderation, …) does NOT surface them — the field is purely
// a discriminator; visibility is decided here.
//
// DISCRIMINATOR — the `civic.process.<verb>` family (started / result_published
// / created) does not carry the process type in `event_type`; multiple types
// emit the same event_type. We read `data.process.type` (set by every emitter
// via emitEvent) as the single discriminator, falling back to the legacy
// data-shape checks for historical events emitted before the field existed.

import { MANIFEST_LIST } from "./processManifests.js";

/**
 * Coarse content category — aligned 1:1 with the FeedFilter `?type=` keys so
 * the inclusion gate, the filter predicate, and the rendered pills can never
 * disagree (the "filter shows fewer than All" bug). Votes, vote-results,
 * wordclouds, proposals, projects, and conversations all live under
 * "activity"; announcements and meeting summaries get their own filter pill.
 */
export type ActivitySurface = "announcement" | "meeting_summary" | "activity";

/**
 * Fine-grained render variant. Each consumer maps this to its own presentation
 * tokens (the frontend → a FeedPillKind CSS class; the digest → a grouping +
 * pill color) via a total, exhaustively-checked switch — stable mappings, not
 * the brittle data-shape sniffing this module replaces.
 */
export type ActivityKind =
  | "vote-open"
  | "vote-closed" // a vote's own results, published when it closes (2026-10-07)
  | "vote-results" // legacy civic.vote_results records
  | "announcement" // admin / synced (Floyd County Gov)
  | "announcement-author" // board member / committee / other authored
  | "meeting"
  | "wordcloud"
  | "proposal"
  | "proposal-closed"
  | "project-created"
  | "project-updated"
  | "conversation"
  | "conversation-results" // legacy deliberation outcome delivered (close)
  | "brief" // universal civic.brief published — the final result of any process
  | "brief-response"; // an official responded to a published brief (anchored)

/**
 * THE color decision (2026-08-28, Adam): every surface colors a card, row,
 * or pill by the underlying PROCESS TYPE, not by the event's lifecycle
 * moment — a proposal is proposal-purple as "New proposal", as "Proposal
 * results", and on its Outcomes row. Kinds collapse onto these keys here,
 * in the same shared classifier that owns feed-worthiness, so the feed,
 * the Outcomes index, and the email digest can never disagree again
 * (they previously kept three drifting palettes keyed by kind).
 *
 * Each key maps to a `--type-<key>-bg/-fg` token pair in the UI's
 * theme.css and a literal hex pair in civic.digest/service.ts
 * PILL_COLORS (emails cannot read CSS variables).
 *
 * Two non-process keys on purpose: "announcement-author" preserves the
 * elected-official vs hub-admin announcement distinction, and
 * "official-response" is an ACT (the government answering a brief), not
 * a process — it keeps its gold everywhere.
 */
export type ActivityColor =
  | "vote"
  | "proposal"
  | "conversation"
  | "project"
  | "wordcloud"
  | "announcement"
  | "announcement-author"
  | "meeting"
  | "official-response"
  | "generic";

export interface Activity {
  surface: ActivitySurface;
  kind: ActivityKind;
  /** Process-type color key — see ActivityColor above. */
  color: ActivityColor;
  /**
   * Canonical, hub-config-free pill label. Single source of truth for both
   * the feed card pill and the email digest pill — so they read identically
   * for the same event. (Announcement labels are role-aware and derived
   * purely from the event payload, so they belong here too.)
   */
  pill: string;
  /**
   * A brief's source process type (kind "brief" only), so a reader that
   * knows the hub can word its pill: a vote's brief is "Brief to the
   * Supervisors" on the feed (Adam, 2026-10-07; briefPillFor in hubCopy).
   */
  briefSource?: string;
  /**
   * Where the card links. Either a dedicated relative SPA path (wordcloud /
   * proposal / conversation, whose public page differs from /process/:id) or
   * the event's own `action_url` verbatim — which may be an absolute external
   * URL (e.g. a synced Floyd-news announcement) that MUST be preserved. The
   * frontend routes it through classifyHref; the digest absolutizes relative
   * paths against the hub UI base.
   */
  href: string;
}

/**
 * Minimal structural view of a civic event. Both the frontend `CivicEvent`
 * and the backend `DigestEvent` are assignable to this, so neither consumer
 * has to adapt its event shape before calling `classifyActivity`.
 */
export interface ClassifierEvent {
  event_type: string;
  process_id: string;
  action_url: string;
  data: Record<string, unknown>;
}

/**
 * Resolve the underlying process type for an event. Prefers the canonical
 * `data.process.type` (stamped by emitEvent for the whole civic.process.*
 * family); falls back to the Polis handler's flat `data.process_type`
 * convention so historical deliberation events still discriminate correctly.
 * Returns undefined for events that carry no type (legacy votes) — callers
 * then fall back to data-shape checks.
 */
function processTypeOf(event: ClassifierEvent): string | undefined {
  const data = event.data ?? {};
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  if (typeof nested === "string") return nested;
  const flat = (data as { process_type?: unknown }).process_type;
  if (typeof flat === "string") return flat;
  return undefined;
}

// --- The table (Architecture 2, ADR-009) -----------------------------------
//
// Each process type declares the cards its events make in its manifest
// (`feed.cards`), and how a Civic Brief of one of its processes reads
// (`feed.brief`). The classifier below walks those rules; it knows no type by
// name. The kinds and colours above are the vocabulary the rules use.

/** Where a card links. */
export type FeedHref =
  /** The process's own page (its manifest's detailPath). */
  | "detail"
  /** The event's action_url, verbatim (may be an external URL). */
  | "action_url"
  /** The page of the process a data field names, else the event's own. */
  | { detailOf: string };

/** A card, or one of the two whose pill is built from the payload. */
export type FeedCard =
  | { surface: ActivitySurface; kind: ActivityKind; color: ActivityColor; pill: string; href: FeedHref }
  /** An announcement: its pill is the author's role (classifyAnnouncement). */
  | "announcement"
  /** A published Civic Brief: it wears its source's colour and pill. */
  | "brief";

/** One event of a type that makes a feed card. */
export interface FeedCardRule {
  event: string;
  /**
   * "event": the event type alone decides (a type's own civic.<type>.* event,
   * or a retired one). Otherwise the event's process type must be this type,
   * or the event carries one of its `legacy` fields.
   */
  match?: "event";
  /**
   * Fields that mark an event as this type's when it was emitted before
   * events carried data.process.type. "string": the field must be a string.
   */
  legacy?: ReadonlyArray<{ field: string; is: "present" | "string" }>;
  /** The card for an event that carries no process type and no type's legacy field (votes, before the field). */
  untypedDefault?: true;
  /** Only when each of these data fields has this value. */
  when?: Readonly<Record<string, string | boolean>>;
  card: FeedCard;
}

/** How a Civic Brief of this type's processes reads. Unset: neutral colour, "process", "Civic Brief". */
export interface FeedBriefStyle {
  color?: ActivityColor;
  /** The reader's noun for one of its processes: "vote". */
  noun?: string;
  /** The brief card's pill: "Vote brief". */
  pill?: string;
}

/** A manifest's `feed`. */
export interface FeedDeclaration {
  cards: readonly FeedCardRule[];
  brief?: FeedBriefStyle;
}

interface TableRule extends FeedCardRule {
  type: string;
  detail: (id: string) => string;
}

const RULES: ReadonlyMap<string, readonly TableRule[]> = (() => {
  const byEvent = new Map<string, TableRule[]>();
  for (const m of MANIFEST_LIST) {
    for (const rule of m.feed?.cards ?? []) {
      const list = byEvent.get(rule.event) ?? [];
      list.push({ ...rule, type: m.descriptor.type, detail: m.detailPath });
      byEvent.set(rule.event, list);
    }
  }
  return byEvent;
})();

const BRIEF_STYLES: ReadonlyMap<string, FeedBriefStyle> = new Map(
  MANIFEST_LIST.flatMap((m) => (m.feed?.brief ? [[m.descriptor.type, m.feed.brief] as const] : [])),
);

/**
 * The only event types `classifyActivity` can return a card for: every event
 * a manifest's feed rule names. The feed asks the database for these types
 * alone (2026-10-07), so a page of cards is not a scan through every ballot
 * and comment. A unit test (feedActivity.test.ts) fails if the classifier
 * returns a card for any other type.
 */
export const FEED_EVENT_TYPES: readonly string[] = [...RULES.keys()];

/**
 * Kinds whose card reads anything beyond its own event payload (titles,
 * counts, images): the server batches their per-process metadata (GET
 * /api/feed's process_meta, GET /api/feed/meta), and the feed seeds its
 * metadata cache with it for these kinds only.
 */
export const FEED_META_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  "vote-open",
  "vote-closed",
  "vote-results",
  "meeting",
  "wordcloud",
  "project-created",
  "project-updated",
  "conversation",
  "conversation-results",
  "announcement",
  "announcement-author",
  // A brief's card is its publish event; a regenerated version replaces its
  // headline in place, marked "Updated <date>" (Actions slice).
  "brief",
]);

/**
 * Classify a civic event into its feed/digest presentation, or null when the
 * event is not feed-worthy. The ONE predicate the gate, renderer, filter, and
 * digest all share. Default-closed: an event no rule names makes no card.
 */
export function classifyActivity(event: ClassifierEvent): Activity | null {
  // Review-lifecycle events are restricted admin/creator correspondence —
  // admins receive them on the events endpoint for the moderation log, but
  // they are never public activity. Excluded regardless of viewer.
  if (event.event_type.startsWith("civic.review.")) return null;

  const rules = RULES.get(event.event_type);
  if (!rules) return null;
  const data = event.data ?? {};
  const processType = processTypeOf(event);
  const holds = (r: TableRule) => !r.when || Object.entries(r.when).every(([k, v]) => data[k] === v);
  const hasLegacy = (r: TableRule) =>
    (r.legacy ?? []).some((l) => (l.is === "string" ? typeof data[l.field] === "string" : data[l.field] !== undefined));

  // 1. Rules the event type alone decides. 2. The event's own type's rules.
  // 3. Rules whose legacy fields it carries (history from before
  // data.process.type). 4. With no type at all, the untyped default.
  const pick =
    rules.find((r) => r.match === "event" && holds(r)) ??
    (processType !== undefined ? rules.find((r) => r.match !== "event" && r.type === processType && holds(r)) : undefined) ??
    rules.find((r) => r.match !== "event" && hasLegacy(r) && holds(r)) ??
    (processType === undefined ? rules.find((r) => r.untypedDefault && holds(r)) : undefined);
  return pick ? cardFor(pick, event, data) : null;
}

function cardFor(rule: TableRule, event: ClassifierEvent, data: Record<string, unknown>): Activity {
  const card = rule.card;
  if (card === "announcement") return classifyAnnouncement(data, event.action_url);
  if (card === "brief") {
    const brief = (data.brief ?? {}) as { source_process_type?: unknown };
    const srcType = typeof brief.source_process_type === "string" ? brief.source_process_type : "";
    const style = BRIEF_STYLES.get(srcType);
    return {
      surface: "activity",
      kind: "brief",
      color: style?.color ?? "generic",
      pill: style?.pill ?? "Civic Brief",
      briefSource: srcType,
      href: rule.detail(event.process_id),
    };
  }
  const href =
    card.href === "detail"
      ? rule.detail(event.process_id)
      : card.href === "action_url"
        ? event.action_url
        : rule.detail(typeof data[card.href.detailOf] === "string" ? (data[card.href.detailOf] as string) : event.process_id);
  return { surface: card.surface, kind: card.kind, color: card.color, pill: card.pill, href };
}

/**
 * Context line for an official-response card — names WHAT is being
 * responded to: the community's record of a completed process. Shared by
 * the feed card (metadata line) and the email digest (row summary) so the
 * two can never phrase it differently. The card deliberately carries NO
 * excerpt of the response itself: a truncated quote can misrepresent an
 * official statement, and the card links to the brief where the full
 * response reads in context.
 */
export function briefResponseContext(sourceType: unknown): string {
  const noun = BRIEF_STYLES.get(typeof sourceType === "string" ? sourceType : "")?.noun ?? "process";
  return `Responding to the community's Civic Brief on this ${noun}`;
}

function classifyAnnouncement(
  data: Record<string, unknown>,
  actionUrl: string,
): Activity {
  const ann = data.announcement as
    | { author_role?: unknown; source?: { origin?: unknown } | null }
    | undefined;
  const rawRole =
    typeof ann?.author_role === "string" ? ann.author_role : null;
  // Legacy "board" → "Board member"; lowercase "admin"/unset → "Admin"; any
  // other free-form role ("Planning Committee", …) is shown verbatim.
  const normalized =
    rawRole === "board"
      ? "Board member"
      : rawRole === "admin" || !rawRole
        ? "Admin"
        : rawRole;
  const isAdmin = normalized === "Admin";
  // Synced-from-external announcements (the news-sync cron, e.g. Floyd County
  // Gov) reuse the admin palette so they group with admin-authored ones under
  // the same filter pill. Keyed on the presence of `source`, not on its
  // origin string: only a sync writes one, and the origin value changed when
  // the module was renamed, so older rows carry a different one.
  const isSynced = Boolean(ann?.source);
  return {
    surface: "announcement",
    // Non-admin authors (board members, committees) get a distinct pill +
    // border color so residents can tell elected-official posts from the hub
    // administrator's.
    kind: isAdmin || isSynced ? "announcement" : "announcement-author",
    color: isAdmin || isSynced ? "announcement" : "announcement-author",
    pill: abbreviateGovernment(normalized),
    href: actionUrl,
  };
}

/**
 * Width-saver for announcement pill labels: "Floyd County Government" →
 * "Floyd County Gov". Single source of truth for both the feed and the email
 * digest (previously duplicated in FeedPost.tsx and digest/service.ts).
 */
function abbreviateGovernment(label: string): string {
  return label.replace(/\bGovernment\b/gi, "Gov");
}

/**
 * One line of a vote's final count for a card or digest row, most votes
 * first: "Yes 12 · No 5 · Unsure 1". Empty when the event carries no tally
 * or nobody voted.
 * Options are stored by their label, so the keys read as written.
 */
export function voteResultLine(data: Record<string, unknown> | undefined): string {
  const result = (data?.result ?? {}) as { tally?: unknown };
  const tally = result.tally;
  if (!tally || typeof tally !== "object") return "";
  const counts = Object.entries(tally as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  if (counts.every(([, n]) => n === 0)) return "";
  return counts
    .sort((a, b) => b[1] - a[1])
    .map(([option, count]) => `${option} ${count}`)
    .join(" · ");
}
