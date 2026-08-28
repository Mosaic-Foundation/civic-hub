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
// It MUST therefore stay framework-agnostic and DEPENDENCY-FREE (no imports).
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
  | "vote-results"
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

export interface Activity {
  surface: ActivitySurface;
  kind: ActivityKind;
  /**
   * Canonical, hub-config-free pill label. Single source of truth for both
   * the feed card pill and the email digest pill — so they read identically
   * for the same event. (Announcement labels are role-aware and derived
   * purely from the event payload, so they belong here too.)
   */
  pill: string;
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

/**
 * Classify a civic event into its feed/digest presentation, or null when the
 * event is not feed-worthy. The ONE predicate the gate, renderer, filter, and
 * digest all share.
 */
export function classifyActivity(event: ClassifierEvent): Activity | null {
  const eventType = event.event_type;
  const id = event.process_id;
  const processType = processTypeOf(event);

  // Review-lifecycle events are restricted admin/creator correspondence —
  // admins receive them on the events endpoint for the moderation log, but
  // they are never public activity. Excluded regardless of viewer.
  if (eventType.startsWith("civic.review.")) return null;

  switch (eventType) {
    case "civic.process.started":
      return classifyStarted(event, processType, id);

    case "civic.process.result_published":
      return classifyResultPublished(event, processType, id);

    case "civic.process.created":
      // Only conversations post a "created" card. Votes post when they open
      // (civic.process.started); proposals/projects post via their own
      // civic.<type>.* events — so created is null for everything else, which
      // is what prevents double-posting.
      if (processType === "civic.polis_deliberation") {
        return {
          surface: "activity",
          kind: "conversation",
          pill: "New conversation",
          href: `/deliberation/${id}`,
        };
      }
      return null;

    case "civic.process.action_taken":
      // An official's public response to a published brief. Every response
      // emits this event (the log is never throttled), but only the ANCHOR
      // — stamped by the write path when no other response to the same
      // brief anchored a card in the last 24h — renders in the feed and
      // digest, so a burst of responses is one card. Suppressed responses
      // still reach readers: the card links to /brief/:id, which shows
      // them all. Any other action_taken stays default-closed.
      if (
        processType === "civic.brief" &&
        event.data?.action === "official_response" &&
        event.data?.feed_anchor === true
      ) {
        return {
          surface: "activity",
          kind: "brief-response",
          pill: "Official response",
          href: `/brief/${id}`,
        };
      }
      return null;

    case "civic.proposal.submitted":
      return {
        surface: "activity",
        kind: "proposal",
        pill: "New proposal",
        href: `/proposal/${id}`,
      };

    case "civic.proposal.closed":
      // Deliberately silent in the feed (Adam, 2026-08-26). A closing proposal
      // used to post its own card AND then its published brief posted another,
      // so one proposal produced two cards saying much the same thing. The
      // brief is the better of the two: the "closed" card sent a reader to a
      // finished proposal with no outcome on it yet.
      //
      // This makes all three process types behave alike — a vote closing has
      // never posted a card, and conversations dropped theirs for the same
      // reason (see shared/polis_deliberation/handler.ts). Publication of the
      // brief is the announcement that a process has concluded.
      //
      // The EVENT still fires and is still on the wire; only the feed card is
      // withheld. Proposals closed before this change keep their existing
      // cards, since the feed is a projection of an append-only log.
      return null;

    case "civic.project.created":
      return {
        surface: "activity",
        kind: "project-created",
        pill: "New project",
        href: event.action_url,
      };

    case "civic.project.updated":
      return {
        surface: "activity",
        kind: "project-updated",
        pill: "Project update",
        href: event.action_url,
      };

    case "civic.outcome_delivered": {
      // Part C — deliberation close. Previously an orphan that rendered as a
      // bland "Activity" card in the feed and was absent from the digest.
      const origin =
        typeof event.data?.originating_process_id === "string"
          ? event.data.originating_process_id
          : id;
      return {
        surface: "activity",
        kind: "conversation-results",
        pill: "Conversation results",
        href: `/deliberation/${origin}`,
      };
    }

    default:
      // Default-CLOSED. Everything not named above — civic.process.updated /
      // ended / vote_submitted / comment_added / aggregation_completed /
      // outcome_recorded / proposed / threshold_met, civic.proposal.supported
      // / endorsed / converted, civic.project.archived / comment_added /
      // sentiment_changed, etc. — is intentionally not feed-worthy.
      return null;
  }
}

function classifyStarted(
  event: ClassifierEvent,
  processType: string | undefined,
  id: string,
): Activity | null {
  // Conversations post their card on `created`, not `started` — exclude here
  // to avoid a double-post (and to fix the legacy mislabel where a
  // deliberation start fell through to the vote branch below).
  if (processType === "civic.polis_deliberation") return null;

  const data = event.data ?? {};
  if (
    processType === "civic.wordcloud" ||
    data.wordcloud_snapshot !== undefined ||
    data.wordcloud_result !== undefined
  ) {
    return {
      surface: "activity",
      kind: "wordcloud",
      pill: "Word cloud",
      href: `/wordcloud/${id}`,
    };
  }

  // Votes — explicit type, or legacy vote events that predate data.process.type
  // (undefined). civic.process.started is otherwise only emitted by votes.
  if (processType === "civic.vote" || processType === undefined) {
    return {
      surface: "activity",
      kind: "vote-open",
      pill: "Vote open",
      href: event.action_url,
    };
  }

  // A new process type emitting `started` we don't recognize — default-closed.
  return null;
}

function classifyResultPublished(
  event: ClassifierEvent,
  processType: string | undefined,
  id: string,
): Activity | null {
  const data = event.data ?? {};

  // Universal brief published — the final result of ANY closed process.
  // Checked first (by processType) so it never falls through to the legacy
  // vote-results branch. The pill names the process that completed.
  if (processType === "civic.brief") {
    const brief = (data.brief ?? {}) as { source_process_type?: unknown };
    const srcType =
      typeof brief.source_process_type === "string"
        ? brief.source_process_type
        : "";
    return {
      surface: "activity",
      kind: "brief",
      pill: briefPill(srcType),
      href: `/brief/${id}`,
    };
  }

  if (
    processType === "civic.wordcloud" ||
    data.wordcloud_snapshot !== undefined ||
    data.wordcloud_result !== undefined
  ) {
    return {
      surface: "activity",
      kind: "wordcloud",
      pill: "Word cloud",
      href: `/wordcloud/${id}`,
    };
  }

  if (processType === "civic.announcement" || data.announcement !== undefined) {
    return classifyAnnouncement(data, event.action_url);
  }

  if (
    processType === "civic.meeting_summary" ||
    data.meeting_summary !== undefined ||
    typeof data.summary_id === "string"
  ) {
    return {
      surface: "meeting_summary",
      kind: "meeting",
      pill: "Meeting summary",
      href: event.action_url,
    };
  }

  if (
    processType === "civic.vote_results" ||
    typeof data.results_id === "string" ||
    typeof data.brief_id === "string"
  ) {
    return {
      surface: "activity",
      kind: "vote-results",
      pill: "Vote results",
      href: event.action_url,
    };
  }

  // Raw vote-process result_published — INTENTIONALLY excluded. Closing a vote
  // emits two result_published events (one from civic.vote_results, caught
  // above, and one from the underlying vote here); residents must see only
  // one post per close. The vote event stays on the log for audit/federation.
  if (processType === "civic.vote" || data.result !== undefined) return null;

  // Unknown shape — default-closed (was a bland "Activity" card before Phase 3).
  return null;
}

/** Per-source-type pill for a published brief — names the process that
 *  completed, so residents see what kind of thing wrapped up. */
function briefPill(sourceType: string): string {
  switch (sourceType) {
    case "civic.polis_deliberation":
      return "Conversation results";
    case "civic.vote":
      return "Vote results";
    case "civic.proposal":
      return "Proposal results";
    case "civic.project":
      return "Project completed";
    default:
      return "Civic Brief";
  }
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
  // Synced-from-external announcements (Floyd County Gov cron) reuse the admin
  // palette so they group with admin-authored ones under the same filter pill.
  const isSynced = ann?.source?.origin === "floyd-news";
  return {
    surface: "announcement",
    // Non-admin authors (board members, committees) get a distinct pill +
    // border color so residents can tell elected-official posts from the hub
    // administrator's.
    kind: isAdmin || isSynced ? "announcement" : "announcement-author",
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
