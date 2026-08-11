import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import { getProcessHandler } from "../../processes/registry.js";
import {
  ProcessReview,
  ReviewTurn,
  ReviewStatus,
  SubmitForReviewInput,
  ReviseInput,
  ProcessSnapshot,
} from "./models.js";
import { emitReviewEvent } from "./events.js";
import {
  notifyCreatorSubmitted,
  notifyAdminNewSubmission,
  notifyCreatorChangesRequested,
  notifyCreatorApproved,
  notifyCreatorDeclined,
  notifyAdminResubmitted,
  notifyAdminWithdrawn,
} from "./email.js";
import { emitEvent } from "../../events/eventEmitter.js";
import { executeAction } from "../../services/processService.js";
import { createProject } from "../civic.projects/index.js";
import { createProposal } from "../civic.proposals/index.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../../config/hub.js";


function getAdminEmails(): string[] {
  return (process.env.CIVIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function takeSnapshot(process: {
  title: string;
  description: string;
  content?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
}): ProcessSnapshot {
  return {
    title: process.title,
    description: process.description,
    content: process.content ?? null,
    config: process.config ?? null,
  };
}

// --- Submit for review ---

export async function submitForReview(
  input: SubmitForReviewInput,
  opts: { notify?: boolean } = {},
): Promise<{ review: ProcessReview; process_id: string }> {
  // Auto-approved admin submissions skip the "under review" notifications
  // (the submission is approved in the same request, so a "needs review" email
  // would be misleading). The approval flow sends its own notification.
  const notify = opts.notify ?? true;
  const handler = getProcessHandler(input.process_type);
  const processId = generateId("proc");
  const reviewId = generateId("rev");
  const initialState = handler
    ? handler.initializeState(input.state ?? {})
    : (input.state ?? {});

  // Insert the process first without review_id (FK requires review to exist)
  const processRow = {
    id: processId,
    type: input.process_type,
    process_version: "1.0",
    title: input.title,
    description: input.description,
    jurisdiction: DEFAULT_JURISDICTION,
    status: "pending_review",
    content: input.content ?? null,
    config: input.config ?? null,
    state: initialState,
    hub_id: HUB_ID,
    created_by: input.creator_id,
  };

  const { error: procErr } = await getDb()
    .from("processes")
    .insert(processRow);
  if (procErr) {
    throw new Error(`Failed to create process for review: ${procErr.message}`);
  }

  // Insert the review record
  const reviewRow = {
    id: reviewId,
    process_id: processId,
    creator_id: input.creator_id,
    creator_name: input.creator_name,
    creator_email: input.creator_email,
    status: "pending_review" as ReviewStatus,
  };

  const { data: reviewData, error: revErr } = await getDb()
    .from("process_reviews")
    .insert(reviewRow)
    .select()
    .single();
  if (revErr) {
    throw new Error(`Failed to create review: ${revErr.message}`);
  }

  // Now link the process back to the review
  await getDb()
    .from("processes")
    .update({ review_id: reviewId })
    .eq("id", processId);

  // Insert the first turn
  const turnId = generateId("turn");
  const { error: turnErr } = await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: 1,
    actor: input.creator_id,
    actor_role: "creator",
    action: "submit",
    note: null,
    process_snapshot: takeSnapshot({
      title: input.title,
      description: input.description,
      content: input.content ?? null,
      config: input.config ?? null,
    }),
  });
  if (turnErr) {
    throw new Error(`Failed to create review turn: ${turnErr.message}`);
  }

  // Emit review event
  await emitReviewEvent({
    event_type: "civic.review.submitted",
    actor: input.creator_id,
    process_id: processId,
    review_id: reviewId,
    data: {
      process_type: input.process_type,
      title: input.title,
    },
  });

  // Notifications (best-effort — don't fail the submission). Suppressed when
  // the caller will auto-approve (admin self-submission).
  if (notify) {
    try {
      await notifyCreatorSubmitted({
        creator_email: input.creator_email,
        creator_name: input.creator_name,
        process_type: input.process_type,
        title: input.title,
        review_id: reviewId,
      });
    } catch (e) {
      console.warn("[review] Failed to notify creator:", e);
    }

    try {
      const admins = getAdminEmails();
      for (const admin of admins) {
        await notifyAdminNewSubmission({
          admin_email: admin,
          creator_name: input.creator_name,
          process_type: input.process_type,
          title: input.title,
          review_id: reviewId,
        });
      }
    } catch (e) {
      console.warn("[review] Failed to notify admin:", e);
    }
  }

  return { review: reviewData as ProcessReview, process_id: processId };
}

/**
 * The single creation path for every reviewable process type (vote, proposal,
 * project, conversation). A process is created the SAME way regardless of who
 * creates it: always submit for review, then auto-approve when the creator is
 * an admin (their submission simply skips the review wait). There are no
 * separate admin-only create branches.
 *
 * Returns a uniform response: `review_id` always; `process_id` is the canonical
 * id; `auto_approved` tells the caller/UI whether the process is already live.
 */
export async function submitAsCreator(
  input: SubmitForReviewInput,
  creatorEmail: string,
): Promise<{ review_id: string; process_id: string; auto_approved: boolean }> {
  const isAdmin = getAdminEmails().includes(creatorEmail.trim().toLowerCase());
  const { review, process_id } = await submitForReview(input, {
    notify: !isAdmin,
  });
  if (isAdmin) {
    await approveReview(review.id, input.creator_id);
  }
  return { review_id: review.id, process_id, auto_approved: isAdmin };
}

// --- Admin actions ---

export async function approveReview(
  reviewId: string,
  adminActor: string,
): Promise<{ review: ProcessReview; process_id: string }> {
  const review = await getReview(reviewId);
  if (!review) throw new Error("Review not found");
  if (review.status !== "pending_review") {
    throw new Error(`Cannot approve review in status: ${review.status}`);
  }

  // Load the process
  const { data: proc, error: procErr } = await getDb()
    .from("processes")
    .select("*")
    .eq("id", review.process_id)
    .single();
  if (procErr || !proc) throw new Error("Process not found for review");

  // Determine the live status based on process type:
  //  - votes start "proposed" (gather support to threshold)
  //  - conversations start "draft" — they need an explicit "Start" action to
  //    create the live Polis conversation before participants can join, so the
  //    UI shows a "Start Conversation" button (going straight to "active" would
  //    show the participate panel with no Polis conversation behind it)
  //  - everything else goes "active"
  const liveStatus =
    proc.type === "civic.vote"
      ? "proposed"
      : proc.type === "civic.polis_deliberation"
        ? "draft"
        : "active";

  // Whether an approved vote enters the community-support ("proposed") phase
  // rather than opening for ballots directly. Drives both the lifecycle action
  // dispatched below and the wording of the approval email — a supported vote
  // is NOT live until it clears its support threshold.
  const voteConfig =
    proc.type === "civic.vote" &&
    proc.state &&
    typeof proc.state === "object" &&
    typeof (proc.state as Record<string, unknown>).config === "object"
      ? ((proc.state as Record<string, unknown>).config as Record<string, unknown>)
      : undefined;
  const voteEntersSupportPhase =
    proc.type === "civic.vote" && voteConfig?.activation_mode !== "direct";
  const voteSupportThreshold =
    typeof voteConfig?.support_threshold === "number"
      ? (voteConfig.support_threshold as number)
      : undefined;

  // Atomically claim the review: flip pending_review → approved in a single
  // conditional update. Only the first caller matches the WHERE clause; any
  // concurrent or duplicate approve (double-click, network retry, stale UI)
  // affects 0 rows and bails out here, BEFORE creating a proposal/project.
  // This is the real guard against duplicate postings.
  const { data: claimedRows, error: revErr } = await getDb()
    .from("process_reviews")
    .update({ status: "approved" as ReviewStatus })
    .eq("id", reviewId)
    .eq("status", "pending_review")
    .select();
  if (revErr) throw new Error(`Failed to update review: ${revErr.message}`);
  if (!claimedRows || claimedRows.length === 0) {
    // Someone already approved this between our read and write.
    throw new Error("Review has already been approved");
  }
  const updatedReview = claimedRows[0];

  // The live id used for the approval email link. Every process type now keeps
  // its single canonical `processes` row id through approval — votes and
  // conversations flip the row in place, and proposals/projects create their
  // child row keyed by the SAME id (no forking a new id). So liveId is always
  // review.process_id.
  const liveId = review.process_id;

  // We've claimed the review. If any posting step below fails, roll the claim
  // back so the review returns to pending_review instead of getting stuck as
  // "approved" with nothing actually posted.
  try {
  // Update process status to live (safe to run once we've claimed the review)
  const now = new Date().toISOString();
  const { error: updErr } = await getDb()
    .from("processes")
    .update({ status: liveStatus, updated_at: now })
    .eq("id", review.process_id);
  if (updErr) throw new Error(`Failed to activate process: ${updErr.message}`);

  // Add the approval turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: adminActor,
    actor_role: "admin",
    action: "approve",
    note: null,
    process_snapshot: null,
  });

  // For types with their own relational tables, create the child row on
  // approval — keyed by the canonical process id (review.process_id) so the
  // placeholder `processes` row becomes the permanent record and we don't fork
  // a second id. The `processes` row's status was already flipped to live
  // above. Votes and conversations carry all their state on the `processes`
  // row, so they need no child row here.
  if (proc.type === "civic.project") {
    const content = (proc.content ?? {}) as Record<string, unknown>;
    await createProject(
      {
        id: review.process_id,
        title: proc.title,
        description: proc.description ?? "",
        sources: (content.sources as string[]) ?? [],
        user_id: review.creator_id,
        assistant_helped: (content.assistant_helped as boolean) ?? false,
        banner_image_url: (content.banner_image_url as string) ?? undefined,
        banner_image_alt: (content.banner_image_alt as string) ?? undefined,
      },
      emitEvent,
    );
  } else if (proc.type === "civic.proposal") {
    const content = (proc.content ?? {}) as Record<string, unknown>;
    const durationMs = (content.proposal_duration_ms as number) || 30 * 24 * 60 * 60 * 1000;
    const closesAt = new Date(Date.now() + durationMs).toISOString();
    await createProposal(
      {
        id: review.process_id,
        title: proc.title,
        description: proc.description ?? undefined,
        optional_links: (content.optional_links as string[]) ?? undefined,
        submitted_by: review.creator_id,
        category: (content.category as string) ?? undefined,
        assistant_helped: (content.assistant_helped as boolean) ?? false,
        closes_at: closesAt,
      },
      emitEvent,
    );
  }

  // Emit review approved event (restricted)
  await emitReviewEvent({
    event_type: "civic.review.approved",
    actor: adminActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: { status: liveStatus },
  });

  // Emit public process created event (the process is now live)
  // Skip for projects and proposals — they emit their own events
  if (proc.type !== "civic.project" && proc.type !== "civic.proposal") {
    await emitEvent({
      event_type: "civic.process.created",
      actor: review.creator_id,
      process_id: review.process_id,
      hub_id: HUB_ID,
      jurisdiction: DEFAULT_JURISDICTION,
      data: {
        process: {
          type: proc.type,
          title: proc.title,
        },
      },
    });
  }

  // Votes are approved into their "proposed" phase: drive the vote's own
  // lifecycle so its STATE machine enters `proposed` (the process row status
  // was set above, but addSupport gates on state.status, which createVoteState
  // leaves at "draft"). This is what activates the "support a proposed vote"
  // mechanism; at the support threshold the vote auto-activates. A vote
  // explicitly configured for "direct" activation (admin/dev tooling) is
  // activated straight away instead.
  if (proc.type === "civic.vote") {
    const action = voteEntersSupportPhase
      ? "process.propose"
      : "process.activate";
    await executeAction(review.process_id, {
      type: action,
      actor: review.creator_id,
      payload: {},
    });
  }

  } catch (workErr) {
    // Posting failed after we claimed the review — revert review + process
    // to pending_review so the admin can retry cleanly rather than hitting
    // "Cannot approve review in status: approved".
    await getDb()
      .from("process_reviews")
      .update({ status: "pending_review" as ReviewStatus })
      .eq("id", reviewId);
    await getDb()
      .from("processes")
      .update({ status: "pending_review" })
      .eq("id", review.process_id);
    throw workErr;
  }

  // Conversations: auto-start on approval. The approval is already committed
  // above (the process is at "draft"); starting creates the live Polis
  // conversation — passing through any seed statements — and flips it to
  // "active" so participants can join immediately, with no manual admin
  // "Start" step. BEST-EFFORT: if Polis is unreachable (e.g. POLIS_AUTH_TOKEN
  // unset in dev, or a transient outage) we log and LEAVE the conversation in
  // "draft" so an admin can Start it manually later — we never fail or roll
  // back the approval over a Polis hiccup (mirrors the close-action guard).
  if (proc.type === "civic.polis_deliberation") {
    try {
      await executeAction(review.process_id, {
        type: "start",
        actor: review.creator_id,
        payload: {},
      });
    } catch (startErr) {
      console.error(
        `[review] auto-start of conversation ${review.process_id} failed — left in "draft" for a manual Start:`,
        startErr instanceof Error ? startErr.message : startErr,
      );
    }
  }

  // Notify creator
  try {
    await notifyCreatorApproved({
      creator_email: review.creator_email,
      creator_name: review.creator_name,
      process_type: proc.type,
      title: proc.title,
      process_id: liveId,
      entered_support_phase: voteEntersSupportPhase,
      support_threshold: voteSupportThreshold,
    });
  } catch (e) {
    console.warn("[review] Failed to notify creator of approval:", e);
  }

  return {
    review: updatedReview as ProcessReview,
    process_id: review.process_id,
  };
}

export async function requestChanges(
  reviewId: string,
  adminActor: string,
  note: string,
): Promise<ProcessReview> {
  const review = await getReview(reviewId);
  if (!review) throw new Error("Review not found");
  if (review.status !== "pending_review") {
    throw new Error(
      `Cannot request changes on review in status: ${review.status}`,
    );
  }

  // Update review status
  const { data: updatedReview, error: revErr } = await getDb()
    .from("process_reviews")
    .update({ status: "changes_requested" as ReviewStatus })
    .eq("id", reviewId)
    .select()
    .single();
  if (revErr) throw new Error(`Failed to update review: ${revErr.message}`);

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: adminActor,
    actor_role: "admin",
    action: "request_changes",
    note,
    process_snapshot: null,
  });

  // Emit event
  await emitReviewEvent({
    event_type: "civic.review.changes_requested",
    actor: adminActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: { note },
  });

  // Notify creator
  try {
    const { data: proc } = await getDb()
      .from("processes")
      .select("type, title")
      .eq("id", review.process_id)
      .single();

    await notifyCreatorChangesRequested({
      creator_email: review.creator_email,
      creator_name: review.creator_name,
      process_type: proc?.type ?? "",
      title: proc?.title ?? "",
      review_id: reviewId,
      note,
    });
  } catch (e) {
    console.warn("[review] Failed to notify creator of changes requested:", e);
  }

  return updatedReview as ProcessReview;
}

export async function declineReview(
  reviewId: string,
  adminActor: string,
  reason: string,
): Promise<ProcessReview> {
  const review = await getReview(reviewId);
  if (!review) throw new Error("Review not found");
  if (review.status !== "pending_review") {
    throw new Error(`Cannot decline review in status: ${review.status}`);
  }

  // Archive the process
  const now = new Date().toISOString();
  await getDb()
    .from("processes")
    .update({ status: "archived", updated_at: now })
    .eq("id", review.process_id);

  // Update review status
  const { data: updatedReview, error: revErr } = await getDb()
    .from("process_reviews")
    .update({ status: "declined" as ReviewStatus })
    .eq("id", reviewId)
    .select()
    .single();
  if (revErr) throw new Error(`Failed to update review: ${revErr.message}`);

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: adminActor,
    actor_role: "admin",
    action: "decline",
    note: reason,
    process_snapshot: null,
  });

  // Emit event
  await emitReviewEvent({
    event_type: "civic.review.declined",
    actor: adminActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: { reason },
  });

  // Notify creator
  try {
    const { data: proc } = await getDb()
      .from("processes")
      .select("type, title")
      .eq("id", review.process_id)
      .single();

    await notifyCreatorDeclined({
      creator_email: review.creator_email,
      creator_name: review.creator_name,
      process_type: proc?.type ?? "",
      title: proc?.title ?? "",
      reason,
      review_id: reviewId,
    });
  } catch (e) {
    console.warn("[review] Failed to notify creator of decline:", e);
  }

  return updatedReview as ProcessReview;
}

// --- Creator actions ---

export async function reviseAndResubmit(
  reviewId: string,
  creatorActor: string,
  input: ReviseInput,
): Promise<ProcessReview> {
  const review = await getReview(reviewId);
  if (!review) throw new Error("Review not found");
  if (review.status !== "changes_requested") {
    throw new Error(
      `Cannot revise review in status: ${review.status}`,
    );
  }
  if (review.creator_id !== creatorActor) {
    throw new Error("Only the creator can revise this submission");
  }

  // Update process fields if provided
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.content !== undefined) updates.content = input.content;
  if (input.config !== undefined) updates.config = input.config;

  const { error: procErr } = await getDb()
    .from("processes")
    .update(updates)
    .eq("id", review.process_id);
  if (procErr)
    throw new Error(`Failed to update process: ${procErr.message}`);

  // Read back the updated process for the snapshot
  const { data: proc } = await getDb()
    .from("processes")
    .select("title, description, content, config, type")
    .eq("id", review.process_id)
    .single();

  // Update review status back to pending_review
  const { data: updatedReview, error: revErr } = await getDb()
    .from("process_reviews")
    .update({ status: "pending_review" as ReviewStatus })
    .eq("id", reviewId)
    .select()
    .single();
  if (revErr) throw new Error(`Failed to update review: ${revErr.message}`);

  // Add the turn with a snapshot
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: creatorActor,
    actor_role: "creator",
    action: "revise_resubmit",
    note: input.note ?? null,
    process_snapshot: proc
      ? takeSnapshot(proc as {
          title: string;
          description: string;
          content?: Record<string, unknown> | null;
          config?: Record<string, unknown> | null;
        })
      : null,
  });

  // Emit event
  await emitReviewEvent({
    event_type: "civic.review.revised",
    actor: creatorActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: { note: input.note ?? null },
  });

  // Notify admin
  try {
    const admins = getAdminEmails();
    for (const admin of admins) {
      await notifyAdminResubmitted({
        admin_email: admin,
        creator_name: review.creator_name,
        process_type: proc?.type ?? "",
        title: proc?.title ?? review.creator_name,
        review_id: reviewId,
      });
    }
  } catch (e) {
    console.warn("[review] Failed to notify admin of resubmission:", e);
  }

  return updatedReview as ProcessReview;
}

export async function withdrawReview(
  reviewId: string,
  creatorActor: string,
): Promise<ProcessReview> {
  const review = await getReview(reviewId);
  if (!review) throw new Error("Review not found");
  if (
    review.status !== "pending_review" &&
    review.status !== "changes_requested"
  ) {
    throw new Error(`Cannot withdraw review in status: ${review.status}`);
  }
  if (review.creator_id !== creatorActor) {
    throw new Error("Only the creator can withdraw this submission");
  }

  // Archive the process
  const now = new Date().toISOString();
  await getDb()
    .from("processes")
    .update({ status: "archived", updated_at: now })
    .eq("id", review.process_id);

  // Update review status
  const { data: updatedReview, error: revErr } = await getDb()
    .from("process_reviews")
    .update({ status: "withdrawn" as ReviewStatus })
    .eq("id", reviewId)
    .select()
    .single();
  if (revErr) throw new Error(`Failed to update review: ${revErr.message}`);

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await getDb().from("review_turns").insert({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: creatorActor,
    actor_role: "creator",
    action: "withdraw",
    note: null,
    process_snapshot: null,
  });

  // Emit event
  await emitReviewEvent({
    event_type: "civic.review.withdrawn",
    actor: creatorActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: {},
  });

  // Notify admin
  try {
    const { data: proc } = await getDb()
      .from("processes")
      .select("type, title")
      .eq("id", review.process_id)
      .single();

    const admins = getAdminEmails();
    for (const admin of admins) {
      await notifyAdminWithdrawn({
        admin_email: admin,
        creator_name: review.creator_name,
        process_type: proc?.type ?? "",
        title: proc?.title ?? "",
      });
    }
  } catch (e) {
    console.warn("[review] Failed to notify admin of withdrawal:", e);
  }

  return updatedReview as ProcessReview;
}

// --- Read operations ---

export async function getReview(
  reviewId: string,
): Promise<ProcessReview | null> {
  const { data, error } = await getDb()
    .from("process_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) throw new Error(`Failed to get review: ${error.message}`);
  return data as ProcessReview | null;
}

export async function getReviewByProcessId(
  processId: string,
): Promise<ProcessReview | null> {
  const { data, error } = await getDb()
    .from("process_reviews")
    .select("*")
    .eq("process_id", processId)
    .maybeSingle();
  if (error) throw new Error(`Failed to get review: ${error.message}`);
  return data as ProcessReview | null;
}

export async function getReviewTurns(
  reviewId: string,
): Promise<ReviewTurn[]> {
  const { data, error } = await getDb()
    .from("review_turns")
    .select("*")
    .eq("review_id", reviewId)
    .order("turn_number", { ascending: true });
  if (error) throw new Error(`Failed to get review turns: ${error.message}`);
  return (data ?? []) as ReviewTurn[];
}

export async function listReviews(
  statusFilter?: string,
): Promise<ProcessReview[]> {
  let query = getDb()
    .from("process_reviews")
    .select("*")
    .order("updated_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list reviews: ${error.message}`);
  return (data ?? []) as ProcessReview[];
}

export async function listCreatorReviews(
  creatorId: string,
): Promise<ProcessReview[]> {
  const { data, error } = await getDb()
    .from("process_reviews")
    .select("*")
    .eq("creator_id", creatorId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list creator reviews: ${error.message}`);
  return (data ?? []) as ProcessReview[];
}

// --- Notification indicator ---

const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Count reviews that need the user's attention and have changed since they
 * last looked. Admins see the pending_review queue; residents see their own
 * submissions where the admin requested changes. "Since they last looked"
 * is keyed off users.reviews_seen_at, so the badge clears on view rather
 * than on action — notifications never pile up.
 */
export async function countReviewNotifications(
  userId: string,
  isAdmin: boolean,
): Promise<number> {
  const { data: userRow } = await getDb()
    .from("users")
    .select("reviews_seen_at")
    .eq("id", userId)
    .maybeSingle();
  const seenAt = (userRow?.reviews_seen_at as string | null) ?? EPOCH;

  let query = getDb()
    .from("process_reviews")
    .select("id", { count: "exact", head: true })
    .gt("updated_at", seenAt);

  if (isAdmin) {
    query = query.eq("status", "pending_review");
  } else {
    query = query.eq("creator_id", userId).eq("status", "changes_requested");
  }

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count notifications: ${error.message}`);
  return count ?? 0;
}

/** Stamp reviews_seen_at = now() for the user, clearing their badge. */
export async function markReviewsSeen(userId: string): Promise<void> {
  const { error } = await getDb()
    .from("users")
    .update({ reviews_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`Failed to mark reviews seen: ${error.message}`);
}

// --- Helpers ---

async function getNextTurnNumber(reviewId: string): Promise<number> {
  const { data, error } = await getDb()
    .from("review_turns")
    .select("turn_number")
    .eq("review_id", reviewId)
    .order("turn_number", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to get turn count: ${error.message}`);
  if (!data || data.length === 0) return 1;
  return (data[0].turn_number as number) + 1;
}
