// civic.brief module — service functions (pure / orchestration)
//
// Pure state transitions and the approval orchestration. No I/O beyond the
// injected callbacks. The host hub persists state changes after these
// return. Mirrors civic.vote_results/service.ts, generalized: the source
// handler already produced the BriefContent, so generation here is just
// wrapping it in the process state.

import type {
  BriefActionOutcome,
  BriefContent,
  BriefContentPatch,
  BriefProcessContext,
  BriefProcessState,
  CreateBriefInput,
  FinalizeSourceFn,
  SendEmailFn,
} from "./models.js";
import { IMAGE_ALT_MAX, IMAGE_URL_MAX } from "./models.js";
import { assertPublicationTransition, canApprove, canEdit } from "./lifecycle.js";
import {
  emitBriefAggregationCompleted,
  emitBriefCreated,
  emitBriefOutcomeRecorded,
  emitBriefResultPublished,
  emitBriefUpdated,
} from "./events.js";
import { formatBriefEmail } from "./email.js";

/** Build the initial BriefProcessState from a handler-produced content. */
export function createBriefState(input: CreateBriefInput): BriefProcessState {
  return {
    type: "civic.brief",
    source_process_id: input.source_process_id,
    source_process_type: input.source_process_type,
    publication_status: "pending",
    generated_at: new Date().toISOString(),
    approved_at: null,
    published_at: null,
    content: normalizeContent(input.content),
    delivered_to: [],
  };
}

/** Defensive normalization so a handler can't hand us a malformed brief. */
function normalizeContent(content: BriefContent): BriefContent {
  return {
    title: content.title ?? "",
    headline: content.headline ?? "",
    summary: content.summary ?? "",
    sections: Array.isArray(content.sections)
      ? content.sections
          .filter((s) => s && (s.heading?.trim() || s.body?.trim()))
          .map((s) => ({ heading: s.heading ?? "", body: s.body ?? "" }))
      : [],
    participation_label: content.participation_label ?? null,
    participation_count:
      typeof content.participation_count === "number"
        ? content.participation_count
        : null,
    comments: sanitizeList(content.comments ?? []),
    admin_notes: content.admin_notes ?? "",
    image_url: content.image_url ?? null,
    image_alt: content.image_alt ?? null,
  };
}

/** Emit the creation events once the brief row is persisted. */
export async function emitCreationEvents(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await emitBriefCreated(ctx, actor, state);
  await emitBriefAggregationCompleted(ctx, actor, state);
}

/**
 * Apply an admin edit to brief content. Rejects once approved. Emits
 * civic.process.updated. Editable fields: comments, admin_notes,
 * headline, summary, image.
 */
export async function editBrief(
  state: BriefProcessState,
  actor: string,
  patch: BriefContentPatch,
  ctx: BriefProcessContext,
): Promise<BriefActionOutcome> {
  if (!canEdit(state)) {
    throw new Error(
      `Brief cannot be edited: publication_status is "${state.publication_status}"`,
    );
  }

  const content = { ...state.content };
  if (patch.comments !== undefined) content.comments = sanitizeList(patch.comments);
  if (patch.admin_notes !== undefined) content.admin_notes = patch.admin_notes;
  if (patch.headline !== undefined) content.headline = patch.headline;
  if (patch.summary !== undefined) content.summary = patch.summary;

  const willTouchImage =
    patch.image_url !== undefined || patch.image_alt !== undefined;
  if (willTouchImage) {
    const nextUrl =
      patch.image_url !== undefined ? patch.image_url : content.image_url ?? null;
    const nextAlt =
      patch.image_alt !== undefined ? patch.image_alt : content.image_alt ?? null;
    const sanitized = sanitizeImage(nextUrl, nextAlt);
    content.image_url = sanitized.image_url;
    content.image_alt = sanitized.image_alt;
  }
  state.content = content;

  await emitBriefUpdated(ctx, actor, state);
  return { state, result: { content } };
}

function sanitizeImage(
  rawUrl: string | null | undefined,
  rawAlt: string | null | undefined,
): { image_url: string | null; image_alt: string | null } {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const alt = typeof rawAlt === "string" ? rawAlt.trim() : "";
  if (url.length === 0) return { image_url: null, image_alt: null };
  if (url.length > IMAGE_URL_MAX) {
    throw new Error(`Image URL must be <= ${IMAGE_URL_MAX} characters.`);
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Image URL must start with http:// or https://.");
  }
  if (alt.length > IMAGE_ALT_MAX) {
    throw new Error(`Alt text must be <= ${IMAGE_ALT_MAX} characters.`);
  }
  return { image_url: url, image_alt: alt.length > 0 ? alt : null };
}

function sanitizeList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Run the approval sequence (mirrors vote_results). Steps in order; halts
 * on failure and leaves the state at the last good step.
 *
 *   1. publication_status = approved, approved_at = now
 *   2. deliver email (HALT on failure)
 *   3. record delivered_to
 *   4. emit outcome_recorded
 *   5. publication_status = published, published_at = now
 *   6. emit result_published (the feed-worthy event)
 *   7. finalize the source process (mark it finalized)
 *
 * Unlike vote_results, delivery recipients being empty is NOT fatal: a
 * conversation/project brief may be published to the feed without an
 * official email list. Email is sent only when recipients are configured.
 */
export async function approveBrief(
  state: BriefProcessState,
  actor: string,
  ctx: BriefProcessContext,
  deps: {
    recipients: string[];
    hubLabel: string;
    publicBriefUrl: string;
    sendEmail: SendEmailFn;
    finalizeSource: FinalizeSourceFn;
  },
): Promise<BriefActionOutcome> {
  if (!canApprove(state)) {
    throw new Error(
      `Brief cannot be approved: publication_status is "${state.publication_status}"`,
    );
  }

  // Step 1: approved
  assertPublicationTransition(state.publication_status, "approved");
  state.publication_status = "approved";
  state.approved_at = new Date().toISOString();

  // Step 2: deliver email (only if recipients configured; halt on failure)
  if (deps.recipients.length > 0) {
    const email = formatBriefEmail(state, {
      hubLabel: deps.hubLabel,
      publicUrl: deps.publicBriefUrl,
    });
    await deps.sendEmail({
      to: deps.recipients,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    // Step 3: record recipients
    state.delivered_to = [...deps.recipients];
  }

  // Step 4: outcome recorded
  await emitBriefOutcomeRecorded(ctx, actor, state);

  // Step 5: published
  assertPublicationTransition(state.publication_status, "published");
  state.publication_status = "published";
  state.published_at = new Date().toISOString();

  // Step 6: result published (feed-worthy)
  await emitBriefResultPublished(ctx, actor, state);

  // Step 7: finalize the source process
  await deps.finalizeSource(
    state.source_process_id,
    state.source_process_type,
    actor,
  );

  return {
    state,
    result: {
      publication_status: state.publication_status,
      approved_at: state.approved_at,
      published_at: state.published_at,
      delivered_to: state.delivered_to,
    },
  };
}

/** Admin-facing read model (full brief detail). */
export function getAdminReadModel(
  state: BriefProcessState,
  processMeta: { id: string; title: string; createdAt: string; createdBy: string },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.brief",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    source_process_type: state.source_process_type,
    publication_status: state.publication_status,
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    content: state.content,
    delivered_to: state.delivered_to,
    created_at: processMeta.createdAt,
    created_by: processMeta.createdBy,
  };
}

/** Public read model (published briefs only). */
export function getPublicReadModel(
  state: BriefProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> | null {
  if (state.publication_status !== "published") return null;
  return {
    id: processMeta.id,
    type: "civic.brief",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    source_process_type: state.source_process_type,
    headline: state.content.headline,
    summary: state.content.summary,
    sections: state.content.sections,
    participation_label: state.content.participation_label,
    participation_count: state.content.participation_count,
    comments: state.content.comments,
    admin_notes: state.content.admin_notes,
    image_url: state.content.image_url ?? null,
    image_alt: state.content.image_alt ?? null,
    delivered_recipient_count: state.delivered_to.length,
    approved_at: state.approved_at,
    generated_at: state.generated_at,
    published_at: state.published_at,
  };
}

/** Summary used by admin listing. */
export function getAdminSummary(
  state: BriefProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.brief",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    source_process_type: state.source_process_type,
    publication_status: state.publication_status,
    headline: state.content.headline,
    participation_count: state.content.participation_count,
    summary_preview: state.content.summary.slice(0, 200),
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    created_at: processMeta.createdAt,
  };
}

// --- Public index (the Outcomes page) --------------------------------------

/**
 * One row in the public outcomes index.
 *
 * Deliberately narrower than the full read model: an index needs enough to
 * decide whether to open something, not the thing itself. Sections, comments
 * and admin notes stay out, which keeps a page of fifty rows small.
 */
export interface BriefIndexEntry {
  id: string;
  title: string;
  source_process_id: string;
  source_process_type: string;
  headline: string;
  /** Null when the process type reports no participation figure. */
  participation_label: string | null;
  published_at: string;
  /** How many processes this outcome is linked to, in either direction.
   *  Lets a row say "3 related" so a reader knows it sits in a thread
   *  before clicking. */
  related_count: number;
}

/**
 * Project one brief onto an index row, or null when it is not public.
 *
 * The publication check lives HERE rather than in the caller's query, so a
 * pending brief cannot reach the index through a query someone writes later
 * without thinking about it. Same reason getPublicReadModel returns null.
 */
export function toIndexEntry(
  state: BriefProcessState,
  processMeta: { id: string; title: string },
  relatedCount = 0,
): BriefIndexEntry | null {
  if (state.publication_status !== "published") return null;
  const publishedAt = state.published_at;
  if (!publishedAt) return null;
  return {
    id: processMeta.id,
    title: processMeta.title,
    source_process_id: state.source_process_id,
    source_process_type: state.source_process_type,
    headline: state.content.headline,
    participation_label: state.content.participation_label,
    published_at: publishedAt,
    related_count: relatedCount,
  };
}

/** Source-process types that can appear in the index, for the filter chips.
 *  Derived from the entries present rather than hardcoded, so a process type
 *  added later shows up the first time one of its briefs publishes. */
export function availableSourceTypes(entries: BriefIndexEntry[]): string[] {
  return [...new Set(entries.map((e) => e.source_process_type))].sort();
}

/** Years present in the index, newest first — the date filter's options.
 *  Civic time is annual; a year bucket is how people actually look back. */
export function availableYears(entries: BriefIndexEntry[]): number[] {
  const years = new Set<number>();
  for (const e of entries) {
    const y = new Date(e.published_at).getUTCFullYear();
    if (Number.isFinite(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * Filter and sort an index. Pure, so the whole behaviour of the page is
 * testable without a database.
 */
export function filterIndex(
  entries: BriefIndexEntry[],
  opts: { sourceTypes?: string[]; year?: number | null; sort?: "newest" | "oldest" } = {},
): BriefIndexEntry[] {
  const types = opts.sourceTypes?.length ? new Set(opts.sourceTypes) : null;
  const out = entries.filter((e) => {
    if (types && !types.has(e.source_process_type)) return false;
    if (opts.year != null) {
      const y = new Date(e.published_at).getUTCFullYear();
      if (y !== opts.year) return false;
    }
    return true;
  });
  // ISO 8601 sorts lexicographically, so string comparison is date order.
  return out.sort((a, b) =>
    opts.sort === "oldest"
      ? a.published_at.localeCompare(b.published_at)
      : b.published_at.localeCompare(a.published_at),
  );
}
