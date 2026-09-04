// "Projects you support were edited" — the in-app badge for supporters who
// are not on the email digest (Adam, 2026-09-03). Same shape as the review
// badge: count what changed since users.edits_seen_at; opening it stamps
// the cursor. Registry-driven: every handler that declares listSupportedBy
// contributes the processes this user supports; the event log supplies the
// edits (data.edit), never a per-edit row of its own.

import { getDb } from "../db/client.js";
import { getAllHandlers, processDetailPath } from "../processes/registry.js";
import { isSubstantiveEdit } from "./processEdits.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

export interface EditNotification {
  process_id: string;
  type: string;
  title: string;
  href: string;
  edits: number;
  latest_at: string;
}

/**
 * Supporters see the processes THEY support; an admin sees every edited
 * process (Adam, 2026-09-03: no admin review of edits, but be notified).
 */
export async function listEditNotifications(userId: string, isAdmin = false): Promise<EditNotification[]> {
  const db = getDb();
  const { data: userRow } = await db.from("users").select("edits_seen_at").eq("id", userId).maybeSingle();
  const seenAt = ((userRow as { edits_seen_at?: string | null } | null)?.edits_seen_at) ?? EPOCH;

  const supported = new Set<string>();
  if (!isAdmin) {
    for (const handler of getAllHandlers()) {
      if (!handler.listSupportedBy) continue;
      for (const id of await handler.listSupportedBy(userId)) supported.add(id);
    }
    if (supported.size === 0) return [];
  }

  let query = db
    .from("events")
    .select("process_id, actor, created_at, data")
    .eq("event_type", "civic.process.updated")
    .gt("created_at", seenAt)
    .order("created_at", { ascending: false });
  if (!isAdmin) query = query.in("process_id", [...supported]);
  const { data: events, error } = await query;
  if (error) throw new Error(`Edit notifications: ${error.message}`);

  const byProcess = new Map<string, { edits: number; latest_at: string }>();
  for (const row of (events ?? []) as Array<{ process_id: string; actor: string | null; created_at: string; data: Record<string, unknown> | null }>) {
    const edit = (row.data as { edit?: { changed_fields?: unknown; previous?: Record<string, unknown>; current?: Record<string, unknown> } } | null)?.edit;
    if (!edit || !isSubstantiveEdit(edit)) continue;
    if (row.actor === userId) continue;
    const cur = byProcess.get(row.process_id) ?? { edits: 0, latest_at: row.created_at };
    cur.edits += 1;
    if (row.created_at > cur.latest_at) cur.latest_at = row.created_at;
    byProcess.set(row.process_id, cur);
  }
  if (byProcess.size === 0) return [];

  const { data: procs } = await db
    .from("processes")
    .select("id, type, title, status")
    .in("id", [...byProcess.keys()]);
  const out: EditNotification[] = [];
  for (const p of (procs ?? []) as Array<{ id: string; type: string; title: string; status: string }>) {
    if (p.status === "archived") continue;
    const agg = byProcess.get(p.id)!;
    out.push({
      process_id: p.id,
      type: p.type,
      title: p.title,
      href: `${processDetailPath(p.type, p.id)}#edits`,
      edits: agg.edits,
      latest_at: agg.latest_at,
    });
  }
  return out.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
}

export interface AdminEditRow {
  process_id: string;
  type: string;
  type_label: string;
  title: string;
  href: string;
  status: string;
  edits: number;
  latest_at: string;
  changed_fields: string[];
  unseen: boolean;
}

/**
 * Admin panel "Edits" tab: every edited process (any type), newest first,
 * with how many of them are new since the admin last opened the tab.
 * Adam (2026-09-03): admin notice of edits belongs in the admin panel,
 * not the account dropdown.
 */
export async function listAllEdits(adminId: string, sinceDays = 90): Promise<{ items: AdminEditRow[]; unseen: number }> {
  const db = getDb();
  const { data: userRow } = await db.from("users").select("edits_seen_at").eq("id", adminId).maybeSingle();
  const seenAt = ((userRow as { edits_seen_at?: string | null } | null)?.edits_seen_at) ?? EPOCH;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await db
    .from("events")
    .select("process_id, created_at, data")
    .eq("event_type", "civic.process.updated")
    .gt("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Admin edits: ${error.message}`);

  const byProcess = new Map<string, { edits: number; latest_at: string; fields: Set<string>; unseen: boolean }>();
  for (const row of (events ?? []) as Array<{ process_id: string; created_at: string; data: Record<string, unknown> | null }>) {
    const edit = (row.data as { edit?: { changed_fields?: unknown; previous?: Record<string, unknown>; current?: Record<string, unknown> } } | null)?.edit;
    if (!edit || !isSubstantiveEdit(edit)) continue;
    const cur = byProcess.get(row.process_id) ?? { edits: 0, latest_at: row.created_at, fields: new Set<string>(), unseen: false };
    cur.edits += 1;
    if (row.created_at > cur.latest_at) cur.latest_at = row.created_at;
    for (const f of edit.changed_fields as string[]) cur.fields.add(f);
    if (row.created_at > seenAt) cur.unseen = true;
    byProcess.set(row.process_id, cur);
  }
  if (byProcess.size === 0) return { items: [], unseen: 0 };

  const { data: procs } = await db.from("processes").select("id, type, title, status").in("id", [...byProcess.keys()]);
  const items: AdminEditRow[] = [];
  for (const p of (procs ?? []) as Array<{ id: string; type: string; title: string; status: string }>) {
    const agg = byProcess.get(p.id)!;
    items.push({
      process_id: p.id,
      type: p.type,
      type_label: friendlyTypeLabel(p.type),
      title: p.title,
      href: `${processDetailPath(p.type, p.id)}#edits`,
      status: p.status,
      edits: agg.edits,
      latest_at: agg.latest_at,
      changed_fields: [...agg.fields],
      unseen: agg.unseen,
    });
  }
  items.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
  return { items, unseen: items.filter((i) => i.unseen).length };
}

function friendlyTypeLabel(type: string): string {
  const map: Record<string, string> = {
    "civic.vote": "Vote",
    "civic.proposal": "Proposal",
    "civic.project": "Project",
    "civic.polis_deliberation": "Conversation",
    "civic.brief": "Brief",
  };
  return map[type] ?? type.replace(/^civic\./, "").replace(/_/g, " ");
}

/** Stamp edits_seen_at = now(), clearing the badge. */
export async function markEditsSeen(userId: string): Promise<void> {
  const { error } = await getDb()
    .from("users")
    .update({ edits_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`Failed to mark edits seen: ${error.message}`);
}
