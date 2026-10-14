// Civic.Social's feedback inbox in the console (feedback routing, 2026-10-15).
//
// Every hub's software reports (streams bug and feature) and hub admins'
// messages (stream admin), grouped by likely duplicates. Civic.Social sets a
// status (received, planned, fixed), which flows back to the hub's badge, and
// pastes the GitHub issue it wrote by hand. Nothing here talks to GitHub, and
// nothing leaves the console: the one email is to a sender who consented,
// when their report is fixed, sent from their hub.

import { ControlInputError, listHubs } from "./hubs.js";
import { inHubScope } from "./inHub.js";
import {
  MOSAIC_STATUSES,
  claimFixedNotice,
  countReceived,
  getMosaicItem,
  listMosaicItems,
  updateMosaicItem,
  type MosaicItem,
  type MosaicStatus,
  type MosaicStream,
} from "../db/platformFeedback.js";
import { groupLikelyDuplicates } from "../shared/feedbackDuplicates.js";
import { sendEmail, unsentReason } from "../utils/email.js";
import { hubDisplayNameSync } from "../services/hubSettings.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { reportError } from "../utils/reportError.js";

const STREAMS: readonly MosaicStream[] = ["bug", "feature", "admin"];

export interface InboxItem extends MosaicItem {
  /** The hub's name: data, never a string in code. */
  hub_name: string;
}

export interface InboxView {
  groups: InboxItem[][];
  /** Items still "received", across every stream: the console's count. */
  received: number;
}

export async function feedbackInbox(filter: { stream?: unknown; status?: unknown }): Promise<InboxView> {
  const stream = STREAMS.includes(filter.stream as MosaicStream) ? (filter.stream as MosaicStream) : undefined;
  const status = MOSAIC_STATUSES.includes(filter.status as MosaicStatus) ? (filter.status as MosaicStatus) : undefined;
  const [items, hubs, received] = await Promise.all([
    listMosaicItems({ stream, status }),
    // Every hub, archived ones too: an archived hub's reports keep its name.
    listHubs(),
    countReceived(),
  ]);
  const names = new Map(hubs.map((h) => [h.id, h.name]));
  const withNames = items.map((i) => ({ ...i, hub_name: names.get(i.source_hub_id) ?? i.source_hub_id }));
  return { groups: groupLikelyDuplicates(withNames), received };
}

export function parseFeedbackPatch(body: unknown): { status?: MosaicStatus; githubIssueUrl?: string | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: { status?: MosaicStatus; githubIssueUrl?: string | null } = {};
  if (b.status !== undefined) {
    if (!MOSAIC_STATUSES.includes(b.status as MosaicStatus)) {
      throw new ControlInputError("Status must be received, planned or fixed.");
    }
    patch.status = b.status as MosaicStatus;
  }
  if (b.github_issue_url !== undefined) {
    const raw = typeof b.github_issue_url === "string" ? b.github_issue_url.trim() : b.github_issue_url;
    if (raw === "" || raw === null) patch.githubIssueUrl = null;
    else if (typeof raw === "string" && /^https:\/\/github\.com\/\S+$/.test(raw) && raw.length <= 500) {
      patch.githubIssueUrl = raw;
    } else {
      throw new ControlInputError("The issue link must be a https://github.com/ address.");
    }
  }
  if (patch.status === undefined && patch.githubIssueUrl === undefined) {
    throw new ControlInputError("Nothing to change.");
  }
  return patch;
}

export interface FeedbackUpdateResult {
  before: MosaicItem;
  item: MosaicItem;
  /** Set when the status became fixed and the sender consented. */
  sender_told?: { sent: boolean; reason?: string };
}

/**
 * Set the status and/or issue link. Fixed, for a sender who consented, sends
 * them one email from their hub (Adam, 2026-10-13): once, however often the
 * status is set to fixed again.
 */
export async function updateFeedbackItem(id: string, body: unknown): Promise<FeedbackUpdateResult | null> {
  const before = await getMosaicItem(id);
  if (!before) return null;
  const patch = parseFeedbackPatch(body);
  const item = await updateMosaicItem(id, patch);
  const result: FeedbackUpdateResult = { before, item };
  if (patch.status === "fixed" && item.contact_ok && item.contact_email && (await claimFixedNotice(id))) {
    result.sender_told = await tellSenderFixed(item);
  }
  return result;
}

async function tellSenderFixed(item: MosaicItem): Promise<{ sent: boolean; reason?: string }> {
  const to = item.contact_email;
  if (!to) return { sent: false, reason: "no address" };
  try {
    return await inHubScope(item.source_hub_id, async () => {
      const r = await sendEmail({ to, ...renderFixedEmail(item, hubDisplayNameSync(), uiBaseUrl()) });
      return r.sent ? { sent: true } : { sent: false, reason: unsentReason(r) };
    });
  } catch (err) {
    reportError("feedback.fixed_notice", "the fixed email could not be sent", {
      id: item.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason: "The email could not be sent." };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email a consenting sender gets when Civic.Social marks their report fixed. Pure. */
export function renderFixedEmail(
  item: Pick<MosaicItem, "stream" | "message">,
  hubName: string,
  hubUrl: string,
): { subject: string; html: string; text: string } {
  const what = item.stream === "feature" ? "idea" : "report";
  const excerpt = item.message.length > 280 ? `${item.message.slice(0, 279)}…` : item.message;
  const subject = `Your ${what} on ${hubName} is done`;
  const text = [
    `Thanks for your ${what} on ${hubName}. Civic.Social, which maintains the software, has marked it fixed.`,
    "",
    `You wrote: "${excerpt}"`,
    "",
    hubUrl,
    "",
    `You get this because you said Civic.Social may contact you about it. This is the only email about it.`,
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <p style="margin:0 0 12px;">Thanks for your ${what} on ${escapeHtml(hubName)}. Civic.Social, which maintains the software, has marked it fixed.</p>
      <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;line-height:1.5;font-size:14px;">${escapeHtml(excerpt).replace(/\n/g, "<br>")}</div>
      <p style="margin:0 0 16px;"><a href="${escapeHtml(hubUrl)}">${escapeHtml(hubName)}</a></p>
      <p style="margin:0;color:#6b7280;font-size:12px;">You get this because you said Civic.Social may contact you about it. This is the only email about it.</p>
    </div>
  `;
  return { subject, html, text };
}
