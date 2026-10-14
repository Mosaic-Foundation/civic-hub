// @civic-raw-client-importer: Civic.Social's feedback inbox (platform_feedback) is platform data, written from any hub and read only by the console.
// Civic.Social's copies of software feedback, across hubs (20261015000000).
//
// Hub code reaches this table only through copyToMosaic(), which writes one
// row and never reads another; the console reads and updates it. A hub can
// never list it, so hub admins never see Civic.Social's inbox.
//
// The privacy rule lives in two places on purpose: copyToMosaic() drops the
// address unless contact_ok, and a CHECK refuses an address without consent.

import { getDb } from "./client.js";
import { generateId } from "../utils/id.js";

export type MosaicStream = "bug" | "feature" | "admin";
export type MosaicOrigin = "resident" | "forwarded" | "admin";
export type MosaicStatus = "received" | "planned" | "fixed";

export const MOSAIC_STATUSES: readonly MosaicStatus[] = ["received", "planned", "fixed"];

export interface MosaicCopyInput {
  hubId: string;
  /** The hub's feedback item; null for an admin's own message. */
  sourceFeedbackId: string | null;
  stream: MosaicStream;
  origin: MosaicOrigin;
  message: string;
  pagePath?: string | null;
  userAgent?: string | null;
  softwareVersion?: string | null;
  screenshotUrl?: string | null;
  contactOk: boolean;
  /** Dropped unless contactOk. */
  contactEmail?: string | null;
}

export interface MosaicItem {
  id: string;
  created_at: string;
  source_hub_id: string;
  source_feedback_id: string | null;
  stream: MosaicStream;
  origin: MosaicOrigin;
  message: string;
  page_path: string | null;
  user_agent: string | null;
  software_version: string | null;
  screenshot_url: string | null;
  contact_ok: boolean;
  contact_email: string | null;
  status: MosaicStatus;
  status_changed_at: string | null;
  github_issue_url: string | null;
  fixed_notified_at: string | null;
}

const COLUMNS =
  "id, created_at, source_hub_id, source_feedback_id, stream, origin, message, page_path, user_agent, software_version, screenshot_url, contact_ok, contact_email, status, status_changed_at, github_issue_url, fixed_notified_at";

/** Write Civic.Social's copy; returns its id and status. */
export async function copyToMosaic(input: MosaicCopyInput): Promise<{ id: string; status: MosaicStatus }> {
  const row = {
    id: generateId("pf"),
    source_hub_id: input.hubId,
    source_feedback_id: input.sourceFeedbackId,
    stream: input.stream,
    origin: input.origin,
    message: input.message,
    page_path: input.pagePath ?? null,
    user_agent: input.userAgent ?? null,
    software_version: input.softwareVersion ?? null,
    screenshot_url: input.screenshotUrl ?? null,
    contact_ok: input.contactOk,
    contact_email: input.contactOk ? (input.contactEmail?.trim() || null) : null,
    status: "received" as const,
  };
  const { error } = await getDb().from("platform_feedback").insert(row);
  if (error) throw new Error(`platform_feedback insert failed: ${error.message}`);
  return { id: row.id, status: row.status };
}

/** The console's read: newest first, optionally one stream or status. */
export async function listMosaicItems(opts: {
  stream?: MosaicStream;
  status?: MosaicStatus;
  limit?: number;
} = {}): Promise<MosaicItem[]> {
  let q = getDb()
    .from("platform_feedback")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
  if (opts.stream) q = q.eq("stream", opts.stream);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(`platform_feedback read failed: ${error.message}`);
  return (data ?? []) as MosaicItem[];
}

export async function getMosaicItem(id: string): Promise<MosaicItem | null> {
  const { data, error } = await getDb().from("platform_feedback").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`platform_feedback read failed: ${error.message}`);
  return (data as MosaicItem | null) ?? null;
}

/** How many items are still "received": the console's count. */
export async function countReceived(): Promise<number> {
  const { count, error } = await getDb()
    .from("platform_feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "received");
  if (error) throw new Error(`platform_feedback count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Set Civic.Social's status and/or the GitHub issue link, and mirror the
 * status onto the hub's own row so its badge shows it. The copy is written
 * first: a failed mirror leaves the hub's badge one step behind, and setting
 * the status again heals it.
 */
export async function updateMosaicItem(
  id: string,
  patch: { status?: MosaicStatus; githubIssueUrl?: string | null },
): Promise<MosaicItem> {
  const update: Record<string, unknown> = {};
  if (patch.status) {
    update.status = patch.status;
    update.status_changed_at = new Date().toISOString();
  }
  if (patch.githubIssueUrl !== undefined) update.github_issue_url = patch.githubIssueUrl;
  const { data, error } = await getDb()
    .from("platform_feedback")
    .update(update)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`platform_feedback update failed: ${error.message}`);
  if (!data) throw new Error(`platform_feedback ${id} not found`);
  const item = data as MosaicItem;
  if (patch.status && item.source_feedback_id) {
    const { error: mirrorError } = await getDb()
      .from("feedback_submissions")
      .update({ mosaic_status: item.status })
      .eq("hub_id", item.source_hub_id)
      .eq("id", item.source_feedback_id);
    if (mirrorError) throw new Error(`feedback_submissions status mirror failed: ${mirrorError.message}`);
  }
  return item;
}

/**
 * Claim the one "fixed" email for an item: true for exactly one caller, and
 * only while the item is fixed, consented and not yet told.
 */
export async function claimFixedNotice(id: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("platform_feedback")
    .update({ fixed_notified_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "fixed")
    .eq("contact_ok", true)
    .not("contact_email", "is", null)
    .is("fixed_notified_at", null)
    .select("id");
  if (error) throw new Error(`platform_feedback notice claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}
