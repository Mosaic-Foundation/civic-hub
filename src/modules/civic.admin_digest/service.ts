// civic.admin_digest service — assemble + render + dispatch.
//
// Once-a-day fan-out: count pending items in each admin queue, render
// one email per admin, send via the existing Resend client. Empty
// digests are skipped silently (matches the user-digest pattern —
// quiet days produce no email, no log noise).

import {
  listProposals,
  type Proposal,
} from "../civic.proposals/index.js";
import { getAllProcesses } from "../../services/processService.js";
import { listFeedback } from "../civic.feedback/index.js";
import { sendEmail } from "../../utils/email.js";
import { uiBaseUrl } from "../../utils/baseUrl.js";
import type {
  AdminDigestPayload,
  PendingItemSummary,
  QueueSnapshot,
} from "./models.js";

const DISPLAY_CAP = 5;
/** The digest runs daily, so "new feedback" means the last 24 hours. */
const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_EXCERPT_LEN = 90;
const HUB_NAME_FALLBACK = "Floyd Civic Hub";

function hubName(): string {
  return process.env.HUB_NAME?.trim() || HUB_NAME_FALLBACK;
}

function toPendingItem(p: Proposal): PendingItemSummary {
  return { id: p.id, title: p.title, created_at: p.created_at };
}

function snapshotFromList(
  items: PendingItemSummary[],
  panelUrl: string,
): QueueSnapshot {
  const sorted = [...items].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  return {
    count: sorted.length,
    items: sorted.slice(0, DISPLAY_CAP),
    panel_url: panelUrl,
  };
}

/**
 * Assemble a fresh snapshot of every admin-review queue.
 * Returns `empty: true` when every queue has count === 0.
 */
export async function buildAdminDigest(): Promise<AdminDigestPayload> {
  const ui = uiBaseUrl();

  // 1. Proposals — the IDEA BOARD (civic.proposal), not proposed votes.
  //
  //    DO NOT CONFLATE THE TWO. A *proposal* is an idea floated for interest
  //    and discussion; it never becomes a vote (see processes/proposalAdapter
  //    .ts). A *proposed vote* is a civic.vote sitting in `proposed` status,
  //    gathering support until it crosses a threshold and opens for balloting.
  //    They share the word and nothing else.
  //
  //    This comment previously described the idea board in proposed-vote terms
  //    — "still gathering support", "threshold met, awaiting admin conversion"
  //    — which was already wrong when written. `endorsed` and `converted` are
  //    legacy values on the proposals table from before that mechanism moved
  //    to civic.vote. Corrected 2026-08-26.
  const submitted = await listProposals("submitted");
  const endorsed = await listProposals("endorsed");
  const proposalItems = [...endorsed, ...submitted].map(toPendingItem);

  // 2. Vote results — civic.vote_results processes whose state has
  //    publication_status === "pending". One DB pass via
  //    getAllProcesses, filter in memory; volume is small.
  // 3. Meeting summaries — same pattern, approval_status === "pending".
  const allProcesses = await getAllProcesses();
  const voteResultsItems: PendingItemSummary[] = [];
  const meetingSummaryItems: PendingItemSummary[] = [];

  for (const proc of allProcesses) {
    const state = proc.state as
      | { publication_status?: unknown; approval_status?: unknown }
      | null
      | undefined;
    if (proc.definition.type === "civic.vote_results") {
      if (state?.publication_status === "pending") {
        voteResultsItems.push({
          id: proc.id,
          title: proc.title,
          created_at: proc.createdAt,
        });
      }
    } else if (proc.definition.type === "civic.meeting_summary") {
      if (state?.approval_status === "pending") {
        meetingSummaryItems.push({
          id: proc.id,
          title: proc.title,
          created_at: proc.createdAt,
        });
      }
    }
  }

  // /admin/proposals was retired on 2026-08-26 (archiving moved onto each
  // process's own page). These proposals are already LIVE — not pending
  // review — so this links to the public proposals surface, not the Process
  // reviews queue, which holds a different thing entirely.
  // 4. Feedback — everything residents sent in the last 24h. Unlike the
  //    queues above this is not a backlog: feedback has no pending state,
  //    so re-reporting it every day would make the digest un-scannable.
  //    The window is what keeps it honest. A failure here must not cost
  //    the admin the rest of their digest, so it degrades to empty.
  const since = new Date(Date.now() - FEEDBACK_WINDOW_MS).toISOString();
  let feedbackItems: PendingItemSummary[] = [];
  try {
    feedbackItems = (await listFeedback({ since })).map((f) => ({
      id: f.id,
      title: `${f.category} — ${excerpt(f.message)}`,
      created_at: f.created_at,
    }));
  } catch (err) {
    console.warn(
      `[admin-digest] Feedback section unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const proposals = snapshotFromList(proposalItems, `${ui}/propose`);
  const voteResults = snapshotFromList(
    voteResultsItems,
    `${ui}/admin/vote-results`,
  );
  const meetingSummaries = snapshotFromList(
    meetingSummaryItems,
    `${ui}/admin/meeting-summaries`,
  );
  const feedback = snapshotFromList(feedbackItems, `${ui}/admin/feedback`);

  return {
    hub_name: hubName(),
    generated_at: new Date().toISOString(),
    proposals,
    vote_results: voteResults,
    meeting_summaries: meetingSummaries,
    feedback,
    empty:
      proposals.count === 0 &&
      voteResults.count === 0 &&
      meetingSummaries.count === 0 &&
      feedback.count === 0,
  };
}

// --- Email rendering ---------------------------------------------------------

/** One-line preview of a feedback message — newlines collapsed, capped. */
function excerpt(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > FEEDBACK_EXCERPT_LEN
    ? `${flat.slice(0, FEEDBACK_EXCERPT_LEN - 1)}…`
    : flat;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function renderQueueSection(
  heading: string,
  noun: { singular: string; plural: string },
  detailPathPrefix: string,
  q: QueueSnapshot,
  opts: {
    /** Joins prefix and id. "#" for surfaces whose items have no own page. */
    detailSeparator?: string;
    /** Overrides noun.plural in the "Open … panel" link. */
    panelLabel?: string;
  } = {},
): string {
  if (q.count === 0) return "";
  const label = pluralize(q.count, noun.singular, noun.plural);
  const itemList = q.items
    .map((it) => {
      const detailHref = `${detailPathPrefix}${opts.detailSeparator ?? "/"}${encodeURIComponent(it.id)}`;
      return `<li style="margin:0 0 6px;line-height:1.4;">
        <a href="${escapeHtml(detailHref)}" style="color:#1e3a5f;text-decoration:none;">${escapeHtml(it.title)}</a>
      </li>`;
    })
    .join("");
  const overflow =
    q.count > q.items.length
      ? `<p style="margin:8px 0 0;color:#6b7280;font-size:13px;">+ ${
          q.count - q.items.length
        } more</p>`
      : "";
  return `
    <section style="margin:0 0 24px;">
      <h3 style="font-size:15px;font-weight:600;margin:0 0 8px;color:#1e3a5f;">
        ${escapeHtml(heading)} — ${q.count} ${label}
      </h3>
      <ul style="list-style:disc;padding-left:20px;margin:0;font-size:14px;">${itemList}</ul>
      ${overflow}
      <p style="margin:10px 0 0;font-size:13px;">
        <a href="${escapeHtml(q.panel_url)}" style="color:#1e3a5f;font-weight:600;">Open ${escapeHtml(opts.panelLabel ?? noun.plural)} panel →</a>
      </p>
    </section>
  `;
}

export function renderAdminDigestEmail(p: AdminDigestPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const totalParts: string[] = [];
  if (p.proposals.count > 0) {
    totalParts.push(
      `${p.proposals.count} ${pluralize(p.proposals.count, "proposal", "proposals")}`,
    );
  }
  if (p.vote_results.count > 0) {
    totalParts.push(
      `${p.vote_results.count} vote ${pluralize(p.vote_results.count, "result", "results")}`,
    );
  }
  if (p.meeting_summaries.count > 0) {
    totalParts.push(
      `${p.meeting_summaries.count} meeting ${pluralize(p.meeting_summaries.count, "summary", "summaries")}`,
    );
  }
  if (p.feedback.count > 0) {
    totalParts.push(
      `${p.feedback.count} feedback ${pluralize(p.feedback.count, "submission", "submissions")}`,
    );
  }
  const subject = `[${p.hub_name}] Admin queue: ${totalParts.join(", ")}`;

  const ui = uiBaseUrl();
  const sections = [
    renderQueueSection(
      // "awaiting review" was a misnomer: these are live idea-board proposals
      // an admin may want to look at, not submissions in the review queue.
      "Open proposals",
      { singular: "proposal", plural: "proposals" },
      `${ui}/propose`,
      p.proposals,
    ),
    renderQueueSection(
      "Vote results awaiting approval",
      { singular: "vote result", plural: "vote results" },
      `${ui}/admin/vote-results`,
      p.vote_results,
    ),
    renderQueueSection(
      "Meeting summaries awaiting review",
      { singular: "meeting summary", plural: "meeting summaries" },
      `${ui}/admin/meeting-summaries`,
      p.meeting_summaries,
    ),
    // Last on purpose: this is "here is what came in", not "here is what
    // is waiting on you". Items deep-link to their row in the archive,
    // which is the only place a submission is ever rendered.
    renderQueueSection(
      "New feedback",
      { singular: "submission", plural: "submissions" },
      `${ui}/admin/feedback`,
      p.feedback,
      { detailSeparator: "#", panelLabel: "feedback" },
    ),
  ].join("");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#1e3a5f;">${escapeHtml(p.hub_name)} — admin queue</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
        Daily summary of items waiting for your review, and feedback
        residents sent in the last 24 hours.
      </p>
      ${sections}
      <p style="margin:32px 0 0;color:#9ca3af;font-size:12px;">
        You receive this because your email is in CIVIC_ADMIN_EMAILS.
      </p>
    </div>
  `;

  // Plaintext alt — same content, no HTML.
  const textParts: string[] = [`${p.hub_name} — admin queue`, ""];
  function appendQueueText(label: string, q: QueueSnapshot): void {
    if (q.count === 0) return;
    textParts.push(`${label}: ${q.count}`);
    for (const it of q.items) {
      textParts.push(`  - ${it.title}`);
    }
    if (q.count > q.items.length) {
      textParts.push(`  + ${q.count - q.items.length} more`);
    }
    textParts.push(`  ${q.panel_url}`);
    textParts.push("");
  }
  appendQueueText("Proposals awaiting review", p.proposals);
  appendQueueText("Vote results awaiting approval", p.vote_results);
  appendQueueText("Meeting summaries awaiting review", p.meeting_summaries);
  appendQueueText("New feedback (last 24h)", p.feedback);
  textParts.push(
    "You receive this because your email is in CIVIC_ADMIN_EMAILS.",
  );
  const text = textParts.join("\n");

  return { subject, html, text };
}

// --- Dispatch ---------------------------------------------------------------

export interface AdminDigestRunResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  empty: boolean;
  generated_at: string;
}

/**
 * Build the digest payload, render once, fan out to every admin email.
 * Failures on individual admins are logged but don't fail the whole run.
 */
export async function runAdminDigest(
  recipients: string[],
): Promise<AdminDigestRunResult> {
  const payload = await buildAdminDigest();

  if (payload.empty) {
    console.log(
      `[admin-digest] All queues empty — skipping send (${recipients.length} recipient(s)).`,
    );
    return {
      total: recipients.length,
      sent: 0,
      skipped: recipients.length,
      failed: 0,
      empty: true,
      generated_at: payload.generated_at,
    };
  }

  if (recipients.length === 0) {
    console.warn(
      "[admin-digest] No recipients configured — set CIVIC_ADMIN_EMAILS.",
    );
    return {
      total: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      empty: false,
      generated_at: payload.generated_at,
    };
  }

  const { subject, html, text } = renderAdminDigestEmail(payload);
  let sent = 0;
  let failed = 0;

  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, text });
    if (result.sent) {
      sent += 1;
      console.log(
        `[admin-digest] Sent to ${to} (resend id: ${result.id ?? "?"})`,
      );
    } else {
      failed += 1;
      console.warn(
        `[admin-digest] Send failed for ${to}: ${result.error ?? "unknown"}`,
      );
    }
  }

  return {
    total: recipients.length,
    sent,
    skipped: 0,
    failed,
    empty: false,
    generated_at: payload.generated_at,
  };
}
