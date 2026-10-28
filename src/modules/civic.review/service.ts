import { ConflictError, ForbiddenError, NotFoundError } from "../../errors/index.js";
import { reportError } from "../../utils/reportError.js";
import { assertProcessTypeCreatable } from "../../services/pluginGate.js";
import { currentHub, currentHubId } from "../../config/hubContext.js";
import { createEdges, processWireIris } from "../../services/processLinks.js";
import { eventToRow } from "../../events/eventStore.js";
import {
  draftPathFor,
  reopenDraftForRevision,
  activationOnApproval,
} from "../../processes/registry.js";
import { validateLinkSet } from "../civic.process_links/index.js";
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
import { buildReviewEvent, emitReviewEvent } from "./events.js";
import {
  notifyCreatorSubmitted,
  notifyAdminNewSubmission,
  notifyCreatorChangesRequested,
  notifyCreatorApproved,
  notifyCreatorDeclined,
  notifyAdminResubmitted,
  notifyAdminWithdrawn,
  notifyAdminActivationFailed,
} from "./email.js";
import { buildEvent } from "../../events/eventEmitter.js";
import { executeAction, getDisabledTypeProcessIds, rowToProcess, type ProcessRow } from "../../services/processService.js";
import { defaultJurisdiction } from "../../config/hub.js";
import { getAdminEmailsSync } from "../../services/hubSettings.js";
import {
  archiveProcessRow,
  readProcessForSnapshot,
  readProcessRow,
  readProcessType,
  readProcessTypeAndTitle,
  setProcessStatusRow,
  updateProcessColumns,
} from "../../services/processRows.js";
import { reviewStore } from "./store.js";

function getAdminEmails(): string[] {
  return getAdminEmailsSync();
}

/**
 * A visitor on a demo hub (2026-10-07, review R25): anyone who is not one of
 * the hub's admins, while the hub is in `demo` mode. Their submissions are
 * stored as demo content (is_sample + added_in_demo), so "Remove sample
 * content" clears them with the samples; and one that passed the automated
 * Code of Conduct check publishes without waiting for an admin. Whether the
 * creator is an admin is the seam's answer (canActor "hub.administer",
 * ADR-011), asked by the controller and passed in.
 */
function isDemoVisitor(creatorIsAdmin: boolean): boolean {
  if (currentHub()?.mode !== "demo") return false;
  return !creatorIsAdmin;
}

/**
 * The address a submission's notices go to (process_reviews.creator_email,
 * NOT NULL): review needs a mailbox. An account without one cannot submit for
 * review; every account has one today.
 */
export function reviewMailbox(email: string | null): string {
  if (email === null) {
    throw new ForbiddenError(
      "Submissions are confirmed by email, and this account has no email address.",
      "submission_no_mailbox",
    );
  }
  return email;
}

/** The actor recorded when a demo hub publishes a visitor's submission itself. */
export const DEMO_PUBLISH_ACTOR = "system:demo-publish";

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
  opts: { notify?: boolean; creatorIsAdmin?: boolean } = {},
): Promise<{ review: ProcessReview; process_id: string }> {
  // Auto-approved admin submissions skip the "under review" notifications
  // (the submission is approved in the same request, so a "needs review" email
  // would be misleading). The approval flow sends its own notification.
  const notify = opts.notify ?? true;
  // The review funnel is a creation path: a type whose plugin is off cannot
  // be submitted on this hub.
  assertProcessTypeCreatable(input.process_type);
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
    jurisdiction: defaultJurisdiction(),
    status: "pending_review",
    content: input.content ?? null,
    config: input.config ?? null,
    state: initialState,
    created_by: input.creator_id,
    // Demo content from the first event on, so every event it ever has is a
    // sample event (kept off /events, deletable with the samples).
    ...(isDemoVisitor(opts.creatorIsAdmin === true) ? { is_sample: true, added_in_demo: true } : {}),
  };

  // Materialize the creator's proposed links. Done here — the one funnel every
  // process type passes through — so creation-time linking is universal rather
  // than something each new type has to wire up.
  //
  // Best-effort by design: a link to a process that has since been removed
  // must not cost someone the submission they just spent time writing. Invalid
  // input is dropped with a warning rather than thrown; a missing target is
  // skipped by the database function.
  let links: Array<Record<string, unknown>> = [];
  if (input.links?.length) {
    try {
      const valid = validateLinkSet(processId, input.links);
      // The linked process's IRI beside its bare id (Architecture 3, ADR-010).
      const iris = await processWireIris(valid.map((l) => l.to_id));
      links = valid.map((l) => ({
        id: generateId("plink"),
        to_id: l.to_id,
        to_iri: iris.get(l.to_id) ?? null,
        relation: l.relation,
        created_by: input.creator_id,
      }));
    } catch (err) {
      console.warn(
        `[review] dropped invalid links on ${processId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const reviewRow = {
    id: reviewId,
    process_id: processId,
    draft_id: input.draft_id ?? null,
    creator_id: input.creator_id,
    creator_name: input.creator_name,
    creator_email: input.creator_email,
    status: "pending_review" as ReviewStatus,
    ...(input.coc_flags?.length ? { coc_flags: input.coc_flags } : {}),
  };

  const turnRow = {
    id: generateId("turn"),
    review_id: reviewId,
    turn_number: 1,
    actor: input.creator_id,
    actor_role: "creator",
    action: "submit",
    note: input.note?.trim() || null,
    process_snapshot: takeSnapshot({
      title: input.title,
      description: input.description,
      content: input.content ?? null,
      config: input.config ?? null,
    }),
  };

  const event = buildReviewEvent({
    event_type: "civic.review.submitted",
    actor: input.creator_id,
    process_id: processId,
    review_id: reviewId,
    data: {
      process_type: input.process_type,
      title: input.title,
      ...(input.coc_flags?.length ? { coc_flagged: true } : {}),
    },
  });

  // The process, its links, the review, the process's link back to it, the
  // first turn and the event: one transaction (submit_for_review,
  // 20261024000000), stamped with the hub it was submitted on.
  const written = await reviewStore.get().submitForReview({
    process: processRow,
    review: reviewRow,
    turn: turnRow,
    links,
    event: eventToRow(event),
  });
  if (written.links_skipped > 0) {
    console.warn(`[review] ${written.links_skipped} link(s) on ${processId} skipped: target gone, or already linked`);
  }
  console.log(`[event] ${event.event_type} by ${event.actor} (${event.id})`);
  const reviewData = written.review;

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
  opts: {
    /**
     * Whether the creator is one of the hub's admins: the seam's answer
     * (canActor "hub.administer", ADR-011), asked by the controller. An
     * admin's own submission is approved at once.
     */
    creatorIsAdmin: boolean;
    /**
     * Whether the creator is an official on a type whose officials publish at
     * once (descriptor creation.resident.publish_at_once; engine 2, A6): the
     * seam's answer (publishesAtOnce), asked by the controller.
     */
    creatorIsOfficialAtOnce?: boolean;
    /**
     * The automated Code of Conduct check ran on exactly this text and found
     * nothing. False when it was not run, was unavailable (it fails open to
     * human review), or the text changed after it.
     */
    cocPassed?: boolean;
  },
): Promise<{ review_id: string; process_id: string; auto_approved: boolean }> {
  const isAdmin = opts.creatorIsAdmin;
  // On a demo hub nobody reviews (review R25): a visitor's submission that
  // passed the check goes live at once, so the evaluator sees what a
  // published one looks like. Beta and live hubs always review.
  const demoPublish = !isAdmin && opts.cocPassed === true && isDemoVisitor(isAdmin);
  // Text the check flagged, sent to the admins anyway, always waits for one:
  // an admin's own included, and on a demo hub too (Adam, 2026-10-12).
  const flagged = (input.coc_flags?.length ?? 0) > 0;
  const autoApprove = !flagged && (isAdmin || opts.creatorIsOfficialAtOnce === true || demoPublish);
  const { review, process_id } = await submitForReview(input, {
    notify: !autoApprove,
    creatorIsAdmin: isAdmin,
  });
  if (autoApprove) {
    // The submission exists now. If going live at once fails (an approval
    // action that must run did not), it stays in the queue for an admin:
    // the submit succeeded, the shortcut did not. Throwing here would tell
    // the person it failed, and their retry would queue the draft twice
    // (Audit 3, seen on dev 2026-10-11).
    try {
      await approveReview(review.id, isAdmin ? input.creator_id : DEMO_PUBLISH_ACTOR);
    } catch (err) {
      reportError("review.auto_approve", err instanceof Error ? err.message : String(err), {
        review_id: review.id,
        process_type: input.process_type,
      });
      return { review_id: review.id, process_id, auto_approved: false };
    }
  }
  return { review_id: review.id, process_id, auto_approved: autoApprove };
}

// --- Admin actions ---

export async function approveReview(
  reviewId: string,
  adminActor: string,
): Promise<{ review: ProcessReview; process_id: string }> {
  const review = await getReview(reviewId);
  if (!review) throw new NotFoundError("Review not found");
  if (review.status !== "pending_review") {
    throw new ConflictError(`Cannot approve review in status: ${review.status}`, "review_not_pending");
  }

  // Load the process
  const proc = await readProcessRow(review.process_id);

  // A submission whose plugin the hub switched off cannot go live: approving
  // it would publish a process nobody can open. It waits, hidden from the
  // queue (listReviews), until the plugin is back on.
  assertProcessTypeCreatable(proc.type, "Approving");

  // What approval does to this process — the status it lands on, and any
  // lifecycle action that has to run for it to be real. The handler declares
  // it (ProcessHandler.activationOnApproval); this service does not know or
  // ask which type it is holding, so a type registered tomorrow is activated
  // by the same code path, on its own terms.
  //
  //   vote          → "proposed" + process.propose   (required)
  //   conversation  → "draft"    + start             (best-effort)
  //   anything else → "active"   + nothing
  const activation = activationOnApproval(rowToProcess(proc));
  const liveStatus = activation.status;

  // Whether this approval puts the process into a community-support phase
  // rather than making it live — today only a vote that must clear a support
  // threshold before it opens for ballots. It changes what the approval email
  // tells the creator, because "approved" and "open" are not the same thing.
  //
  // Read from the DECLARED activation rather than from the type: "proposed" is
  // what the support phase means, so any type that adopts the same shape gets
  // the same honest wording without a second edit here.
  const entersSupportPhase = activation.status === "proposed";
  const stateConfig =
    entersSupportPhase &&
    proc.state &&
    typeof proc.state === "object" &&
    typeof (proc.state as Record<string, unknown>).config === "object"
      ? ((proc.state as Record<string, unknown>).config as Record<string, unknown>)
      : undefined;
  const voteSupportThreshold =
    typeof stateConfig?.support_threshold === "number"
      ? (stateConfig.support_threshold as number)
      : undefined;

  // Atomically claim the review: flip pending_review → approved in a single
  // conditional update. Only the first caller matches the WHERE clause; any
  // concurrent or duplicate approve (double-click, network retry, stale UI)
  // affects 0 rows and bails out here, BEFORE creating a proposal/project.
  // This is the real guard against duplicate postings.
  const updatedReview = await reviewStore.get().claimPendingReview(reviewId);
  if (updatedReview === null) {
    // Someone already approved this between our read and write.
    throw new ConflictError("Review has already been approved", "already_approved");
  }

  // The live id used for the approval email link. Every process type now keeps
  // its single canonical `processes` row id through approval — votes and
  // conversations flip the row in place, and proposals/projects create their
  // child row keyed by the SAME id (no forking a new id). So liveId is always
  // review.process_id.
  const liveId = review.process_id;

  // We've claimed the review. If any posting step below fails, roll the claim
  // back so the review returns to pending_review instead of getting stuck as
  // "approved" with nothing actually posted.
  //
  // Going live is one write (2026-10-12): the process leaves pending_review
  // and its public `created` event is written in the same transaction, which
  // for a REQUIRED activation is the activation's own transaction. A failed
  // activation therefore writes neither, and the process is still waiting in
  // the queue with nothing in the public log. Before, the status was flipped
  // and `created` emitted first, so a failed vote approval left a stray
  // `created` behind and the eventual approval wrote a second (Audit 4).
  const process = rowToProcess(proc);
  const handler = getProcessHandler(proc.type);
  let wentLive = false;
  try {
  // Add the approval turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await reviewStore.get().insertTurn({
    id: turnId,
    review_id: reviewId,
    turn_number: nextTurn,
    actor: adminActor,
    actor_role: "admin",
    action: "approve",
    note: null,
    process_snapshot: null,
  });

  // The public `created` event, unless the type announces its own creation
  // when its row is made (proposals: civic.proposal.submitted; projects:
  // civic.project.created): a type that makes its own row on approval
  // (onApproved) announces itself there, as it did before.
  const createdEvent = handler?.onApproved
    ? null
    : buildEvent({
        event_type: "civic.process.created",
        actor: review.creator_id,
        process_id: review.process_id,
        jurisdiction: defaultJurisdiction(),
        data: { process: { type: proc.type, title: proc.title } },
      });

  if (activation.action?.onFailure === "required") {
    // The process row is still pending_review; the activation moves it live,
    // with `created` first, or nothing happens at all.
    await executeAction(
      review.process_id,
      { type: activation.action.type, actor: review.creator_id, payload: {} },
      "system",
      { leadingEvents: createdEvent ? [createdEvent] : [] },
    );
  } else {
    await reviewStore.get().transitionProcess({
      hubId: currentHubId(),
      processId: review.process_id,
      toStatus: liveStatus,
      actor: adminActor,
      event: null,
      expectedStatus: "pending_review",
      expectedVersion: process.version,
      events: createdEvent ? [createdEvent] : [],
    });
  }
  wentLive = true;

  // Storage the type makes once it is live (proposals and projects create
  // their own row, keyed by the canonical process id).
  if (handler?.onApproved) {
    await handler.onApproved(process, review.creator_id);
  }

  // Emit review approved event (restricted)
  await emitReviewEvent({
    event_type: "civic.review.approved",
    actor: adminActor,
    process_id: review.process_id,
    review_id: reviewId,
    data: { status: liveStatus },
  });
  } catch (workErr) {
    // Posting failed after we claimed the review — revert the review (and the
    // process, if it went live) to pending_review so the admin can retry
    // cleanly rather than hitting "Cannot approve review in status: approved".
    await reviewStore.get().setReviewStatus(reviewId, "pending_review");
    if (wentLive) {
      await setProcessStatusRow(review.process_id, "pending_review");
    }
    throw workErr;
  }

  // A BEST-EFFORT activation runs after the approval has committed, and its
  // failure never rolls anything back — an outage in a service we don't own
  // (Polis) must not undo an admin's decision, and the process rests at a
  // status an admin can drive by hand.
  //
  // But it is no longer SILENT. Until now the only trace of a failure here was
  // a console.error, which is how a conversation approved on 2026-09-01 sat at
  // "waiting to start" for three days while the admin screen said "approved"
  // and the resident who created it saw nothing happen. Every admin now gets
  // an email naming the process, where it is resting, and why.
  let activationStalled = false;
  if (activation.action?.onFailure === "best_effort") {
    try {
      await executeAction(review.process_id, {
        type: activation.action.type,
        actor: review.creator_id,
        payload: {},
      }, "system");
    } catch (startErr) {
      activationStalled = true;
      const reason =
        startErr instanceof Error ? startErr.message : String(startErr);
      console.error(
        `[review] activation "${activation.action.type}" of ${proc.type} ${review.process_id} failed — resting at "${liveStatus}" for a manual start:`,
        reason,
      );
      try {
        for (const admin of getAdminEmails()) {
          await notifyAdminActivationFailed({
            admin_email: admin,
            process_type: proc.type,
            title: proc.title,
            process_id: review.process_id,
            resting_status: liveStatus,
            error: reason,
          });
        }
      } catch (mailErr) {
        console.error(
          "[review] Failed to alert admins of a stalled activation:",
          mailErr,
        );
      }
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
      entered_support_phase: entersSupportPhase,
      // Never invite someone to share a process that did not open.
      activation_stalled: activationStalled,
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
  if (!review) throw new NotFoundError("Review not found");
  if (review.status !== "pending_review") {
    throw new ConflictError(
      `Cannot request changes on review in status: ${review.status}`,
      "review_not_pending",
    );
  }

  // Update review status
  const updatedReview = await reviewStore.get().updateReview(reviewId, { status: "changes_requested" as ReviewStatus });

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await reviewStore.get().insertTurn({
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
    const proc = await readProcessTypeAndTitle(review.process_id);

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
  if (!review) throw new NotFoundError("Review not found");
  if (review.status !== "pending_review") {
    throw new ConflictError(`Cannot decline review in status: ${review.status}`, "review_not_pending");
  }

  // Archive the process
  const now = new Date().toISOString();
  await archiveProcessRow(review.process_id, now);

  // Update review status
  const updatedReview = await reviewStore.get().updateReview(reviewId, { status: "declined" as ReviewStatus });

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await reviewStore.get().insertTurn({
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
    const proc = await readProcessTypeAndTitle(review.process_id);

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
  if (!review) throw new NotFoundError("Review not found");
  if (review.status !== "changes_requested") {
    throw new ConflictError(
      `Cannot revise review in status: ${review.status}`,
      "review_not_pending",
    );
  }
  if (review.creator_id !== creatorActor) {
    throw new ForbiddenError("Only the creator can revise this submission");
  }

  // Update process fields if provided
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.content !== undefined) updates.content = input.content;
  if (input.config !== undefined) updates.config = input.config;
  if (input.state !== undefined) {
    // Same path as submitForReview: the handler turns raw submit input into
    // its initial state, so a revised vote/conversation is exactly what a
    // fresh submission of the same draft would be.
    const current = await readProcessType(review.process_id);
    const handler = getProcessHandler(String(current.type));
    updates.state = handler ? handler.initializeState(input.state) : input.state;
  }

  await updateProcessColumns(review.process_id, updates);

  // Related processes: the revised draft's picks replace the creator's
  // earlier ones (an admin's additions during review are not the creator's
  // and are kept). Best-effort, like creation-time linking.
  if (input.links !== undefined) {
    try {
      await reviewStore.get().deleteLinksCreatedBy(review.process_id, creatorActor);
      if (input.links.length) {
        const links = validateLinkSet(review.process_id, input.links);
        await createEdges(review.process_id, links, creatorActor);
      }
    } catch (err) {
      console.warn(
        `[review] dropped invalid links on revise of ${review.process_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Read back the updated process for the snapshot
  const proc = await readProcessForSnapshot(review.process_id);

  // Update review status back to pending_review
  const updatedReview = await reviewStore.get().updateReview(reviewId, {
    status: "pending_review" as ReviewStatus,
    ...(input.coc_flags !== undefined ? { coc_flags: input.coc_flags?.length ? input.coc_flags : null } : {}),
  });

  // Add the turn with a snapshot
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await reviewStore.get().insertTurn({
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
  if (!review) throw new NotFoundError("Review not found");
  if (
    review.status !== "pending_review" &&
    review.status !== "changes_requested"
  ) {
    throw new ConflictError(`Cannot withdraw review in status: ${review.status}`, "review_not_pending");
  }
  if (review.creator_id !== creatorActor) {
    throw new ForbiddenError("Only the creator can withdraw this submission");
  }

  // Archive the process
  const now = new Date().toISOString();
  await archiveProcessRow(review.process_id, now);

  // Update review status
  const updatedReview = await reviewStore.get().updateReview(reviewId, { status: "withdrawn" as ReviewStatus });

  // Add the turn
  const nextTurn = await getNextTurnNumber(reviewId);
  const turnId = generateId("turn");
  await reviewStore.get().insertTurn({
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
    const proc = await readProcessTypeAndTitle(review.process_id);

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
  return reviewStore.get().reviewById(reviewId);
}

export async function getReviewByProcessId(
  processId: string,
): Promise<ProcessReview | null> {
  return reviewStore.get().reviewOfProcess(processId);
}

export async function getReviewTurns(
  reviewId: string,
): Promise<ReviewTurn[]> {
  return reviewStore.get().turnsOf(reviewId);
}

/**
 * Reviews of a process whose plugin the hub switched off are left out of
 * every list and count: the submission cannot be approved (approveReview)
 * and its page is gone. Nothing is deleted; they return with the plugin.
 */
async function withoutDisabledTypes<T extends { process_id: string }>(rows: T[]): Promise<T[]> {
  const off = await getDisabledTypeProcessIds();
  return off.size === 0 ? rows : rows.filter((r) => !off.has(r.process_id));
}

export async function listReviews(
  statusFilter?: string,
): Promise<ProcessReview[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const rows = await reviewStore.get().allReviews(statusFilter);
  return withoutDisabledTypes(rows);
}

export async function listCreatorReviews(
  creatorId: string,
): Promise<ProcessReview[]> {
  const data = await reviewStore.get().reviewsOfCreator(creatorId);
  return withoutDisabledTypes(data);
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
  const seenAt = (await reviewStore.get().reviewsSeenAt(userId)) ?? EPOCH;

  // Paged, not a count: reviews of a switched-off plugin are left out below.
  const rows = await reviewStore.get().reviewProcessesNeedingAttention({ userId, isAdmin, since: seenAt });

  return (await withoutDisabledTypes(rows)).length;
}

/**
 * Record the draft a review's process is edited from, for reviews that
 * predate `draft_id` (before 2026-09-02). Only ever fills a null.
 */
export async function setReviewDraftId(reviewId: string, draftId: string): Promise<void> {
  await reviewStore.get().fillDraftId(reviewId, draftId);
}

/** Stamp reviews_seen_at = now() for the user, clearing their badge. */
export async function markReviewsSeen(userId: string): Promise<void> {
  await reviewStore.get().setReviewsSeenAt(userId, new Date().toISOString());
}

// --- Helpers ---

async function getNextTurnNumber(reviewId: string): Promise<number> {
  const latest = await reviewStore.get().latestTurnNumber(reviewId);
  if (latest === null) return 1;
  return latest + 1;
}


/**
 * "Edit & resubmit": hand the creator their real drafting form back. Flips
 * the draft the review came from to "drafting" (through the type's handler,
 * so a type added later only has to declare `reopenDraft`) and returns where
 * to send them. Reviews that predate `draft_id` return null and fall back to
 * the inline title/description form.
 */
export async function reopenForRevision(
  reviewId: string,
  creatorActor: string,
): Promise<{ draft_id: string; draft_path: string } | null> {
  const review = await getReview(reviewId);
  if (!review) throw new NotFoundError("Review not found");
  if (review.creator_id !== creatorActor) {
    throw new ForbiddenError("Only the creator can revise this submission");
  }
  if (review.status !== "changes_requested") {
    throw new ConflictError(`Cannot revise review in status: ${review.status}`, "review_not_pending");
  }
  if (!review.draft_id) return null;

  const proc = await readProcessType(review.process_id);
  const type = String(proc.type);
  const path = draftPathFor(type, review.draft_id);
  if (!path) return null;

  await reopenDraftForRevision(type, review.draft_id);
  return { draft_id: review.draft_id, draft_path: `${path}${path.includes("?") ? "&" : "?"}review=${encodeURIComponent(reviewId)}` };
}
