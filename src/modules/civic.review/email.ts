import { sendEmail } from "../../utils/email.js";
import { uiBaseUrl } from "../../utils/baseUrl.js";

/**
 * Escape user-controlled values before interpolating into email HTML. Without
 * this, a resident could put markup (a phishing link, tracking pixel, or
 * spoofed content) in a process title or a review note and have the hub send
 * it as hub-branded HTML to the creator or admin.
 */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send via Resend (the same path used by the digest and OTP sign-in) and
 * surface failures loudly. The review module previously used the SMTP
 * mailer, whose env vars aren't set in prod — so every review email
 * silently fell back to console logging and never reached anyone.
 */
async function send(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const result = await sendEmail(input);
  if (!result.sent) {
    console.error(
      `[review/email] Failed to send "${input.subject}" to ${input.to}: ${result.error}`,
    );
  }
}

function processTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    "civic.vote": "Vote",
    "civic.proposal": "Proposal",
    "civic.polis_deliberation": "Conversation",
    "civic.project": "Project",
  };
  return labels[type] || "Process";
}

export async function notifyCreatorSubmitted(input: {
  creator_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  review_id: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/my-submissions/${input.review_id}`;

  await send({
    to: input.creator_email,
    subject: `Your ${typeLabel} "${input.title}" is in review`,
    html: `
      <p>Hi ${esc(input.creator_name)},</p>
      <p>Your ${typeLabel} <strong>"${esc(input.title)}"</strong> has been submitted and is now in review.</p>
      <p>The hub admin will review it shortly. You'll be notified when there's an update.</p>
      <p><a href="${url}">View your submission status</a></p>
    `,
    text: `Hi ${input.creator_name},\n\nYour ${typeLabel} "${input.title}" has been submitted and is now in review.\n\nThe hub admin will review it shortly. You'll be notified when there's an update.\n\nView your submission: ${url}`,
  });
}

export async function notifyAdminNewSubmission(input: {
  admin_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  review_id: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/admin/reviews/${input.review_id}`;

  await send({
    to: input.admin_email,
    subject: `New ${typeLabel} "${input.title}" submitted for review by ${input.creator_name}`,
    html: `
      <p>${esc(input.creator_name)} submitted a new ${typeLabel} for review:</p>
      <p><strong>"${esc(input.title)}"</strong></p>
      <p><a href="${url}">Review it now</a></p>
    `,
    text: `${input.creator_name} submitted a new ${typeLabel} for review:\n\n"${input.title}"\n\nReview it: ${url}`,
  });
}

/**
 * A process was approved, but the lifecycle action that makes it real failed.
 *
 * This is the alert that did not exist when a conversation approved on
 * 2026-09-01 sat at "waiting to start" for three days — Polis rejected a
 * duplicate seed statement, the best-effort catch swallowed it, and the only
 * trace was a console.error. The approval itself stands and nothing is lost;
 * the process just needs a manual push, and now someone is told so.
 */
export async function notifyAdminActivationFailed(input: {
  admin_email: string;
  process_type: string;
  title: string;
  process_id: string;
  resting_status: string;
  error: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/admin/processes`;

  await send({
    to: input.admin_email,
    subject: `Action needed: ${typeLabel} "${input.title}" was approved but did not start`,
    html: `
      <p>You approved the ${typeLabel} <strong>"${esc(input.title)}"</strong>, but the step that
      makes it live did not complete. <strong>The approval stands</strong> — nothing was lost, and
      the creator has already been told it was approved.</p>
      <p>It is resting at <strong>${esc(input.resting_status)}</strong>, which means residents
      cannot take part in it yet. Open it in the admin area and start it manually.</p>
      <p><a href="${url}">Go to the admin process list</a></p>
      <p style="color:#666;font-size:13px">Process <code>${esc(input.process_id)}</code><br>
      Reason: ${esc(input.error)}</p>
    `,
    text: `You approved the ${typeLabel} "${input.title}", but the step that makes it live did not complete.\n\nThe approval stands — nothing was lost, and the creator has already been told it was approved. It is resting at "${input.resting_status}", which means residents cannot take part in it yet. Open it in the admin area and start it manually.\n\n${url}\n\nProcess ${input.process_id}\nReason: ${input.error}`,
  });
}

export async function notifyCreatorChangesRequested(input: {
  creator_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  review_id: string;
  note: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/my-submissions/${input.review_id}`;

  await send({
    to: input.creator_email,
    subject: `Changes requested on your ${typeLabel} "${input.title}"`,
    html: `
      <p>Hi ${esc(input.creator_name)},</p>
      <p>The admin has requested changes on your ${typeLabel} <strong>"${esc(input.title)}"</strong>:</p>
      <blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555;">${esc(input.note)}</blockquote>
      <p><a href="${url}">View and revise your submission</a></p>
    `,
    text: `Hi ${input.creator_name},\n\nThe admin has requested changes on your ${typeLabel} "${input.title}":\n\n"${input.note}"\n\nView and revise: ${url}`,
  });
}

export async function notifyCreatorApproved(input: {
  creator_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  process_id: string;
  /**
   * True when an approved vote enters the community-support ("proposed")
   * phase instead of opening for ballots — the email must not claim it is
   * "live" in that case.
   */
  entered_support_phase?: boolean;
  support_threshold?: number;
  /**
   * True when the approval stood but the step that opens the process failed
   * (a Polis outage, say). The creator must not be told it is "live" and
   * invited to share a link to something nobody can take part in — the same
   * mistake from the admin's side that let a stalled conversation sit unseen.
   */
  activation_stalled?: boolean;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();

  const pathMap: Record<string, string> = {
    "civic.vote": "/process",
    "civic.proposal": "/proposal",
    "civic.polis_deliberation": "/deliberation",
    "civic.project": "/project",
  };
  const basePath = pathMap[input.process_type] || "/process";
  const url = `${ui}${basePath}/${input.process_id}`;

  if (input.entered_support_phase) {
    const threshold = input.support_threshold ?? 5;
    await send({
      to: input.creator_email,
      subject: `Your ${typeLabel} "${input.title}" is approved — now gathering support`,
      html: `
        <p>Hi ${esc(input.creator_name)},</p>
        <p>Your ${typeLabel} <strong>"${esc(input.title)}"</strong> has been approved and published as a proposed vote.</p>
        <p>Voting opens once <strong>${threshold} residents</strong> support it. Share it with neighbors who care about this issue to help it reach the threshold.</p>
        <p><a href="${url}">View your ${typeLabel}</a></p>
      `,
      text: `Hi ${input.creator_name},\n\nYour ${typeLabel} "${input.title}" has been approved and published as a proposed vote.\n\nVoting opens once ${threshold} residents support it. Share it with neighbors who care about this issue to help it reach the threshold.\n\nView it: ${url}`,
    });
    return;
  }

  if (input.activation_stalled) {
    await send({
      to: input.creator_email,
      subject: `Your ${typeLabel} "${input.title}" is approved — opening shortly`,
      html: `
        <p>Hi ${esc(input.creator_name)},</p>
        <p>Your ${typeLabel} <strong>"${esc(input.title)}"</strong> has been approved.</p>
        <p>It is not open to participants quite yet — the last step hit a snag on our side. The hub
        admin has been alerted and will finish opening it. Nothing you submitted was lost, and you
        do not need to do anything.</p>
        <p>We'll let you know when it's live. Hold off on sharing it until then.</p>
        <p><a href="${url}">View your ${typeLabel}</a></p>
      `,
      text: `Hi ${input.creator_name},\n\nYour ${typeLabel} "${input.title}" has been approved.\n\nIt is not open to participants quite yet — the last step hit a snag on our side. The hub admin has been alerted and will finish opening it. Nothing you submitted was lost, and you do not need to do anything.\n\nWe'll let you know when it's live. Hold off on sharing it until then.\n\nView it: ${url}`,
    });
    return;
  }

  await send({
    to: input.creator_email,
    subject: `Your ${typeLabel} "${input.title}" is now live!`,
    html: `
      <p>Hi ${esc(input.creator_name)},</p>
      <p>Your ${typeLabel} <strong>"${esc(input.title)}"</strong> has been approved and is now live on the hub.</p>
      <p><a href="${url}">View your ${typeLabel}</a></p>
      <p>This is the moment to share it — the more neighbors who see it, the more you'll hear back. Send them this link:<br>${url}</p>
    `,
    text: `Hi ${input.creator_name},\n\nYour ${typeLabel} "${input.title}" has been approved and is now live on the hub.\n\nView it: ${url}\n\nThis is the moment to share it — the more neighbors who see it, the more you'll hear back. Send them this link:\n${url}`,
  });
}

export async function notifyCreatorDeclined(input: {
  creator_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  reason: string;
  review_id: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/my-submissions/${input.review_id}`;

  await send({
    to: input.creator_email,
    subject: `Your ${typeLabel} "${input.title}" was not approved`,
    html: `
      <p>Hi ${esc(input.creator_name)},</p>
      <p>Your ${typeLabel} <strong>"${esc(input.title)}"</strong> was not approved for the following reason:</p>
      <blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555;">${esc(input.reason)}</blockquote>
      <p><a href="${url}">View details</a></p>
    `,
    text: `Hi ${input.creator_name},\n\nYour ${typeLabel} "${input.title}" was not approved.\n\nReason: ${input.reason}\n\nView details: ${url}`,
  });
}

export async function notifyAdminResubmitted(input: {
  admin_email: string;
  creator_name: string;
  process_type: string;
  title: string;
  review_id: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);
  const ui = uiBaseUrl();
  const url = `${ui}/admin/reviews/${input.review_id}`;

  await send({
    to: input.admin_email,
    subject: `${input.creator_name} revised their ${typeLabel} "${input.title}"`,
    html: `
      <p>${esc(input.creator_name)} has revised and resubmitted their ${typeLabel}:</p>
      <p><strong>"${esc(input.title)}"</strong></p>
      <p><a href="${url}">Review it now</a></p>
    `,
    text: `${input.creator_name} has revised and resubmitted their ${typeLabel}:\n\n"${input.title}"\n\nReview it: ${url}`,
  });
}

export async function notifyAdminWithdrawn(input: {
  admin_email: string;
  creator_name: string;
  process_type: string;
  title: string;
}): Promise<void> {
  const typeLabel = processTypeLabel(input.process_type);

  await send({
    to: input.admin_email,
    subject: `${input.creator_name} withdrew their ${typeLabel} "${input.title}"`,
    html: `
      <p>${esc(input.creator_name)} has withdrawn their ${typeLabel}:</p>
      <p><strong>"${esc(input.title)}"</strong></p>
      <p>No action needed — it has been removed from the review queue.</p>
    `,
    text: `${input.creator_name} has withdrawn their ${typeLabel}:\n\n"${input.title}"\n\nNo action needed — it has been removed from the review queue.`,
  });
}
