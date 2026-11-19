// feedActivity.ts — THE single source of truth for "what is feed-worthy".
//
// Phase 3 of the 2026-06-25 consistency audit (decisions/
// audit-2026-06-25-process-and-feed-consistency.md §2). Before this module,
// the feed-worthiness decision was forked across FOUR drifting copies:
//   1. ui/src/components/Feed.tsx        (kindFromEvent — the inclusion gate)
//   2. ui/src/components/FeedPost.tsx    (eventToPost — the renderer)
//   3. ui/src/components/FeedFilter.tsx  (buildFilterPredicate — the ?type= filter)
//   4. features/digest/filter.ts (isDigestRenderable + classifyItemKind)
// They could not be diffed mechanically (a flat Set vs a data-shape switch)
// and had already drifted — generic "Activity" cards, a wordcloud mislabeled
// as a vote in the digest, proposals/projects/conversations visible in-app but
// absent from email. This module collapses all four into ONE classifier.
//
// SHARED ACROSS BOTH RUNTIMES — consumed by:
//   - the Vite frontend (Feed / FeedPost / FeedFilter), and
//   - the Node backend (the digest feature's filter + service, features/digest/).
// It MUST therefore stay framework-agnostic and free of server code: it
// imports only plain data, the process manifests
// (src/shared/processManifests.ts) and the space type's palette
// (src/shared/spacePalette.ts).
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

import { LEGACY_TYPES, MANIFEST_LIST } from "./processManifests.js";
import { SPACE_PALETTE } from "./spacePalette.js";

/**
 * Coarse content category — aligned 1:1 with the FeedFilter `?type=` keys so
 * the inclusion gate, the filter predicate, and the rendered pills can never
 * disagree (the "filter shows fewer than All" bug). "activity" is the
 * kernel's own, where most cards go; a type's card rule may name a surface of
 * its own (Announcements' "announcement", News Sync's "news", Meeting
 * summaries' "meeting_summary"), which gets its own filter pill while that
 * type's plugin is shown (its UI module's `feedFilter`). The kernel names none
 * of them (kernel step 3, Nov 19): FEED_SURFACES lists what the manifests name.
 */
export type ActivitySurface = string;

/** The kernel's own surface: every card no type gives a surface of its own. */
export const ACTIVITY_SURFACE = "activity";

/**
 * Fine-grained render variant. Each consumer maps this to its own presentation
 * tokens (the frontend → a FeedPillKind CSS class; the digest → a grouping +
 * pill color) via a total, exhaustively-checked switch — stable mappings, not
 * the brittle data-shape sniffing this module replaces.
 */
/**
 * A card kind: one a type's card rule names ("vote-open"), listed with its
 * digest section and order in the space type's palette
 * (src/shared/spacePalette.ts), or one a package declares in its manifest's
 * `feed.kinds` (engine 2, A5: the Events plugin's "event"). The kernel names
 * none but "brief", the card of a published Civic Brief.
 */
export type ActivityKind = string;

/**
 * THE color decision (2026-08-28, Adam): every surface colors a card, row,
 * or pill by the underlying PROCESS TYPE, not by the event's lifecycle
 * moment — a proposal is proposal-purple as "New proposal", as "Proposal
 * results", and on its Outcomes row. Kinds collapse onto these keys here,
 * in the same shared classifier that owns feed-worthiness, so the feed,
 * the Outcomes index, and the email digest can never disagree again
 * (they previously kept three drifting palettes keyed by kind).
 *
 * Each key maps to a `--type-<key>-bg/-fg` token pair in the UI and an
 * email pill pair; the space type's palette (src/shared/spacePalette.ts)
 * lists its keys, and a package declares its own with its card kind (A5).
 * The kernel's own is "generic".
 */
export type ActivityColor = string;

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
   * Who a post copied in by News Sync is from ("Floyd County Government"),
   * shown as "From …" on its card. Unset on everything else.
   */
  from?: string;
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

/**
 * A card built from its event's payload by the type that declares it
 * (Announcements: the pill is the author's role; News Sync: the pill and
 * "From" line are its source's). `surface` and `color` are what it is usually
 * filed under and coloured, read where no event is at hand (the filter list,
 * a type's colour); `fromPayload` gives the card itself.
 */
export interface PayloadCard {
  surface: ActivitySurface;
  color: ActivityColor;
  fromPayload: (data: Record<string, unknown>, actionUrl: string) => Activity;
}

/** A card, one built from its payload, or a published Civic Brief (it wears its source's colour and pill). */
export type FeedCard =
  | { surface: ActivitySurface; kind: ActivityKind; color: ActivityColor; pill: string; href: FeedHref }
  | PayloadCard
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

/**
 * A colour family a package carries (engine 2, A5; every package's own
 * default since kernel step 4, Nov 19: "each plugin carries its own default
 * colour"). Its light pair, and optionally its dark pair and its email pill.
 * The space type's palette may list the same key, and then its values win
 * (src/shared/spacePalette.ts); an admin's theme wins over both.
 */
export interface PackageColor {
  /** Lowercase letters, digits and hyphens: the UI's `--type-<key>-*` tokens. */
  key: string;
  /** What Settings → Theme calls it. */
  label: string;
  /** The light mode's text colour and wash, #rrggbb. Its fg is the theme's default hue. */
  fg: string;
  bg: string;
  /** The dark mode's (a light tone for words, a dark tint behind). Absent: the kernel's neutral dark. */
  dark?: { fg: string; bg: string };
  /** Its pill in the email digest. Absent: the light pair. */
  email?: { fg: string; bg: string };
}

/**
 * A card kind a package adds (engine 2, A5): what its pill and card edge are
 * coloured, what the theme calls the colour, and where the email digest puts
 * it. Every surface reads these; no hub list names the kind.
 */
export interface FeedKindDeclaration {
  /** The kind its `cards` rules name ("event"). Not one of the hub's own. */
  kind: string;
  /** Its colour family: a key of its own, the default text colour and wash, and the theme's label. */
  color: PackageColor;
  /** The digest's section for it: a key, the heading, and the line under a card's title. */
  digest: { section: string; heading: string; summary?: (data: Record<string, unknown>) => string | null };
}

/** A manifest's `feed`. */
export interface FeedDeclaration {
  cards: readonly FeedCardRule[];
  brief?: FeedBriefStyle;
  /** Card kinds of its own (A5). */
  kinds?: readonly FeedKindDeclaration[];
}

/** Every card kind the configured packages declare, by kind, with the type that declared it. */
export const DECLARED_FEED_KINDS: ReadonlyMap<string, FeedKindDeclaration & { type: string }> = new Map(
  MANIFEST_LIST.flatMap((m) => (m.feed?.kinds ?? []).map((k) => [k.kind, { ...k, type: m.descriptor.type }] as const)),
);

/**
 * Every colour family the configured packages declare, in load order: each
 * manifest's own `colors`, then its card kinds' (A5). The first declaration
 * of a key stands.
 */
export const DECLARED_COLORS: readonly PackageColor[] = (() => {
  const byKey = new Map<string, PackageColor>();
  for (const m of MANIFEST_LIST) {
    for (const c of [...(m.colors ?? []), ...(m.feed?.kinds ?? []).map((k) => k.color)]) if (!byKey.has(c.key)) byKey.set(c.key, c);
  }
  return [...byKey.values()];
})();

interface TableRule extends FeedCardRule {
  type: string;
  detail: (id: string) => string;
}

const RULES: ReadonlyMap<string, readonly TableRule[]> = (() => {
  const byEvent = new Map<string, TableRule[]>();
  const add = (type: string, detail: (id: string) => string, rules: readonly FeedCardRule[]) => {
    for (const rule of rules) {
      const list = byEvent.get(rule.event) ?? [];
      list.push({ ...rule, type, detail });
      byEvent.set(rule.event, list);
    }
  };
  for (const m of MANIFEST_LIST) {
    // A retired type's cards, for its stored events (engine 2, C), where its
    // own manifest stood: just before the type that carries it.
    for (const l of LEGACY_TYPES.filter((x) => x.carriedBy === m.descriptor.type)) add(l.type, l.detailPath, l.feed?.cards ?? []);
    add(m.descriptor.type, m.detailPath, m.feed?.cards ?? []);
  }
  return byEvent;
})();

const BRIEF_STYLES: ReadonlyMap<string, FeedBriefStyle> = new Map(
  MANIFEST_LIST.flatMap((m) => (m.feed?.brief ? [[m.descriptor.type, m.feed.brief] as const] : [])),
);

/**
 * Every surface a card can be filed under: the ones the manifests' card rules
 * name, in load order, then the kernel's "activity". The feed's `?surface=`
 * accepts these alone.
 */
export const FEED_SURFACES: readonly ActivitySurface[] = [
  ...new Set(
    MANIFEST_LIST.flatMap((m) =>
      (m.feed?.cards ?? []).flatMap((r) => (typeof r.card === "object" && r.card.surface !== ACTIVITY_SURFACE ? [r.card.surface] : [])),
    ),
  ),
  ACTIVITY_SURFACE,
];

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
export const FEED_META_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>(
  SPACE_PALETTE.kinds.filter((k) => k.meta).map((k) => k.kind),
);

/**
 * Classify a civic event into its feed/digest presentation, or null when the
 * event is not feed-worthy. The ONE predicate the gate, renderer, filter, and
 * digest all share. Default-closed: an event no rule names makes no card.
 */
export function classifyActivity(event: ClassifierEvent): Activity | null {
  const pick = pickRule(event);
  return pick ? cardFor(pick, event, event.data ?? {}) : null;
}

/**
 * The process type whose card rule classified this event (the vote, for its
 * closing count), or undefined when no card is made. The digest asks that
 * type's handler for its own line (kernel step 3).
 */
export function classifiedType(event: ClassifierEvent): string | undefined {
  return pickRule(event)?.type;
}

function pickRule(event: ClassifierEvent): TableRule | undefined {
  // Review-lifecycle events are restricted admin/creator correspondence —
  // admins receive them on the events endpoint for the moderation log, but
  // they are never public activity. Excluded regardless of viewer.
  if (event.event_type.startsWith("civic.review.")) return undefined;

  const rules = RULES.get(event.event_type);
  if (!rules) return undefined;
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
  return pick;
}

function cardFor(rule: TableRule, event: ClassifierEvent, data: Record<string, unknown>): Activity {
  const card = rule.card;
  if (card === "brief") {
    const brief = (data.brief ?? {}) as { source_process_type?: unknown };
    const srcType = typeof brief.source_process_type === "string" ? brief.source_process_type : "";
    const style = BRIEF_STYLES.get(srcType);
    return {
      surface: ACTIVITY_SURFACE,
      kind: "brief",
      color: style?.color ?? "generic",
      pill: style?.pill ?? "Civic Brief",
      briefSource: srcType,
      href: rule.detail(event.process_id),
    };
  }
  if ("fromPayload" in card) return card.fromPayload(data, event.action_url);
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

