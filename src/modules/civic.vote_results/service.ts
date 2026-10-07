// civic.vote_results module — service functions (pure / orchestration)
//
// Pure state transitions and the approval orchestration sequence. No I/O
// lives here beyond what the injected callbacks perform. The host hub is
// responsible for persisting state changes after these functions return.

import type {
  CreateVoteResultsFromVoteInput,
  FinalizeLinkedVoteFn,
  SendEmailFn,
  VoteContextSnapshot,
  VoteResultsActionOutcome,
  VoteResultsContent,
  VoteResultsContentPatch,
  VoteResultsProcessContext,
  VoteResultsProcessState,
} from "./models.js";
import { IMAGE_ALT_MAX, IMAGE_URL_MAX } from "./models.js";
import { assertPublicationTransition, canApprove, canEdit } from "./lifecycle.js";
import {
  emitVoteResultsAggregationCompleted,
  emitVoteResultsCreated,
  emitVoteResultsOutcomeRecorded,
  emitVoteResultsResultPublished,
  emitVoteResultsUpdated,
} from "./events.js";
import { formatVoteResultsEmail } from "./email.js";

/**
 * Build the initial VoteResultsProcessState from a completed vote.
 * Generation is deterministic and synchronous: participation count =
 * distinct voters, position breakdown = sorted tally, comments seeded
 * from civic.input.
 */
export function createVoteResultsState(
  input: CreateVoteResultsFromVoteInput,
): VoteResultsProcessState {
  const content = generateVoteResultsContent(input);
  return {
    type: "civic.vote_results",
    source_process_id: input.source_process_id,
    publication_status: "pending",
    generated_at: new Date().toISOString(),
    approved_at: null,
    published_at: null,
    content,
    delivered_to: [],
  };
}

function generateVoteResultsContent(
  input: CreateVoteResultsFromVoteInput,
): VoteResultsContent {
  const entries = Object.entries(input.tally).sort((a, b) => b[1] - a[1]);
  const total = input.total_votes;
  const position_breakdown = entries.map(([option_id, count]) => ({
    option_id,
    option_label: option_id, // options are user-authored strings; id == label for MVP
    count,
    percentage: total > 0 ? Math.round((count / total) * 100) : 0,
  }));
  const vote_context: VoteContextSnapshot = {
    description: input.vote_description,
    method: input.vote_method ?? "yes_no_unsure",
    options: input.vote_options,
    starts_at: input.vote_starts_at,
    ends_at: input.vote_ends_at,
    content: input.vote_content ?? null,
  };
  return {
    title: input.vote_title,
    participation_count: total,
    position_breakdown,
    // Seeded from civic.input. Admin can edit these in the review UI.
    comments: sanitizeList(input.comments ?? []),
    admin_notes: "",
    vote_context,
  };
}

/**
 * Emit the creation events. Called by the host hub once the vote-results
 * row is persisted. Name kept generic — works for any module that wants
 * a created+aggregation_completed pair at Phase 0/4.
 */
export async function emitCreationEvents(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await emitVoteResultsCreated(ctx, actor, state);
  await emitVoteResultsAggregationCompleted(ctx, actor, state);
}

/**
 * Apply an admin edit to vote-results content. Rejects if the record has
 * already been approved. Emits `civic.process.updated`.
 */
export async function editVoteResults(
  state: VoteResultsProcessState,
  actor: string,
  patch: VoteResultsContentPatch,
  ctx: VoteResultsProcessContext,
): Promise<VoteResultsActionOutcome> {
  if (!canEdit(state)) {
    throw new Error(
      `Vote results cannot be edited: publication_status is "${state.publication_status}"`,
    );
  }

  const content = { ...state.content };
  if (patch.comments !== undefined) {
    content.comments = sanitizeList(patch.comments);
  }
  if (patch.admin_notes !== undefined) {
    content.admin_notes = patch.admin_notes;
  }
  // Image fields — patch can set, replace, or clear. Validates the
  // alt-text-required-when-image-set rule the same way civic.announcement
  // does, so the two modules stay behaviorally consistent. Patches that
  // touch only one of the two are merged with the existing state before
  // validating, so PATCH-ing a new image_url + image_alt together works
  // and PATCH-ing image_alt alone (e.g. fixing a typo) does too.
  const willTouchImage =
    patch.image_url !== undefined || patch.image_alt !== undefined;
  if (willTouchImage) {
    const nextUrl =
      patch.image_url !== undefined
        ? patch.image_url
        : content.image_url ?? null;
    const nextAlt =
      patch.image_alt !== undefined
        ? patch.image_alt
        : content.image_alt ?? null;
    const sanitized = sanitizeImage(nextUrl, nextAlt);
    content.image_url = sanitized.image_url;
    content.image_alt = sanitized.image_alt;
  }
  state.content = content;

  await emitVoteResultsUpdated(ctx, actor, state);

  return { state, result: { content } };
}

/**
 * Validate and normalize the image_url / image_alt pair. Mirrors
 * civic.announcement: image_url is optional; image_alt is also
 * optional but encouraged (the composer's hint asks the admin to add
 * one). We don't reject empty alt — see civic.announcement/service.ts
 * sanitizeContent for the rationale.
 */
function sanitizeImage(
  rawUrl: string | null | undefined,
  rawAlt: string | null | undefined,
): { image_url: string | null; image_alt: string | null } {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const alt = typeof rawAlt === "string" ? rawAlt.trim() : "";
  if (url.length === 0) {
    return { image_url: null, image_alt: null };
  }
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
 * Run the approval sequence. Performs steps in order; if any step fails,
 * halts and the caller is responsible for surfacing the error. Mutations
 * happen on the passed-in state object.
 *
 * Sequence (Civic Process Spec Phases 5 → 6):
 *   1. publication_status = approved, approved_at = now
 *   2. send email (HALT on failure — record stays "approved", no events)
 *   3. record delivered_to
 *   4. emit outcome_recorded
 *   5. publication_status = published, published_at = now
 *   6. emit result_published (vote-results)
 *   7. finalize linked vote (which emits vote.result_published — that
 *      vote event is filtered out of Feed/digest as of Slice 8.5 to
 *      eliminate the duplicate post; it stays on the event log for
 *      audit / federation purposes)
 */
export async function approveVoteResults(
  state: VoteResultsProcessState,
  actor: string,
  ctx: VoteResultsProcessContext,
  deps: {
    recipients: string[];
    hubLabel: string;
    publicVoteResultsUrl: string;
    sendEmail: SendEmailFn;
    finalizeLinkedVote: FinalizeLinkedVoteFn;
  },
): Promise<VoteResultsActionOutcome> {
  if (!canApprove(state)) {
    throw new Error(
      `Vote results cannot be approved: publication_status is "${state.publication_status}"`,
    );
  }
  if (deps.recipients.length === 0) {
    throw new Error(
      "Cannot approve vote results: no email recipients configured (BOARD_RECIPIENT_EMAIL).",
    );
  }

  // Step 1: transition to approved
  assertPublicationTransition(state.publication_status, "approved");
  state.publication_status = "approved";
  state.approved_at = new Date().toISOString();

  // Step 2: deliver email (halt on failure)
  const email = formatVoteResultsEmail(state, {
    hubLabel: deps.hubLabel,
    publicUrl: deps.publicVoteResultsUrl,
  });
  const report = await deps.sendEmail({
    to: deps.recipients,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  // Step 3: record recipients — only those really sent; anyone the hub's
  // mode held back is recorded apart (src/shared/delivery.ts).
  state.delivered_to = report ? [...report.sent] : [...deps.recipients];
  if (report && report.held_back.length > 0) state.held_back = report.held_back;

  // Step 4: outcome recorded (Phase 5)
  await emitVoteResultsOutcomeRecorded(ctx, actor, state);

  // Step 5: transition to published
  assertPublicationTransition(state.publication_status, "published");
  state.publication_status = "published";
  state.published_at = new Date().toISOString();

  // Step 6: result published (Phase 6 — the vote-results record itself)
  await emitVoteResultsResultPublished(ctx, actor, state);

  // Step 7: finalize the linked vote — emits vote.result_published
  await deps.finalizeLinkedVote(state.source_process_id, actor);

  return {
    state,
    result: {
      publication_status: state.publication_status,
      approved_at: state.approved_at,
      published_at: state.published_at,
      delivered_to: state.delivered_to,
      held_back: state.held_back ?? [],
    },
  };
}

/**
 * Admin-facing read model (full vote-results detail).
 */
export function getAdminReadModel(
  state: VoteResultsProcessState,
  processMeta: {
    id: string;
    title: string;
    createdAt: string;
    createdBy: string;
  },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.vote_results",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    publication_status: state.publication_status,
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    content: state.content,
    delivered_to: state.delivered_to,
    held_back: state.held_back ?? [],
    created_at: processMeta.createdAt,
    created_by: processMeta.createdBy,
  };
}

/**
 * Public read model (published vote-results only). Excludes fields
 * irrelevant or sensitive for public consumption (e.g. delivered_to
 * email list — only an "approved on <date>" indicator is exposed).
 */
export function getPublicReadModel(
  state: VoteResultsProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> | null {
  if (state.publication_status !== "published") return null;
  return {
    id: processMeta.id,
    type: "civic.vote_results",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    participation_count: state.content.participation_count,
    position_breakdown: state.content.position_breakdown,
    comments: state.content.comments,
    admin_notes: state.content.admin_notes,
    vote_context: state.content.vote_context,
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
  state: VoteResultsProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.vote_results",
    title: processMeta.title,
    source_process_id: state.source_process_id,
    publication_status: state.publication_status,
    participation_count: state.content.participation_count,
    // 200-char preview of the snapshotted vote description so the admin
    // list row carries enough context to recognize the vote.
    vote_description_preview:
      state.content.vote_context?.description?.slice(0, 200) ?? "",
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    created_at: processMeta.createdAt,
  };
}
