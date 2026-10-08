// @civic-raw-client-importer: entitlements are platform data, held before any hub exists; read and written as the service role.
// Entitlements: a right to do something on the platform (session 4b, Adam
// 2026-10-08). Today one kind, "create one hub", granted by an invite code
// the operator mints in the console. A later payment creates the same kind
// of row with source "payment", so the code is an entitlement, not a
// password: what it allows, how many, until when.
//
// An invite code is shown once, when minted, and stored only as its SHA-256
// hash. A code is checked with checkInviteCode(); every reason it cannot be
// used (wrong, used, expired, revoked) gets the same answer, INVITE_REFUSED,
// so the start page never says which.
//
// Spending is two steps around the create, so a failed create leaves the
// code unused and two creates cannot both spend it:
//   claimEntitlement()   holds the row for CLAIM_MS (a conditional update:
//                        only one caller wins);
//   createHub()          (the caller);
//   redeemEntitlement()  records the use and releases the hold, or
//   releaseClaim()       releases it after a failed create.

import { createHash, randomInt } from "node:crypto";
import { getDb } from "../db/client.js";
import { generateId } from "../utils/id.js";

/** The kinds of entitlement. Checked here, not by a database constraint. */
export const ENTITLEMENT_KINDS = ["hub.create"] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

/** Where an entitlement came from. "payment" arrives with billing. */
export const ENTITLEMENT_SOURCES = ["invite"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const DEFAULT_INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 90;
/** How long a create may hold an entitlement before another may try. */
export const CLAIM_MS = 2 * 60 * 1000;

/** The one answer for every code that cannot be used. */
export const INVITE_REFUSED =
  "That code can't be used. Check it, or ask the person who gave it to you for a new one.";

export class EntitlementError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "EntitlementError";
  }
}

// --- Codes -----------------------------------------------------------------

// Crockford's base32: no I, L, O or U, so a code read aloud or retyped
// survives. 12 characters, 60 bits, in three groups: XXXX-XXXX-XXXX.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12;

export function generateInviteCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/**
 * A typed code as it is hashed: upper case, no spaces or hyphens, and the
 * letters people confuse with digits read as the digits. Null when it
 * cannot be a code at all.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}

export function hashInviteCode(normalized: string): string {
  return createHash("sha256").update(`civic-invite:${normalized}`).digest("hex");
}

// --- Rows --------------------------------------------------------------------

const COLUMNS =
  "id, kind, quantity, used, source, code_hint, note, created_by, created_at, expires_at, revoked_at, revoked_by, claimed_until, claimed_by";

export interface EntitlementRow {
  id: string;
  kind: string;
  quantity: number;
  used: number;
  source: string;
  code_hint: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  claimed_until: string | null;
  claimed_by: string | null;
}

export type EntitlementStatus = "unused" | "used" | "expired" | "revoked";

export interface Redemption {
  email: string;
  hub_id: string | null;
  at: string;
}

export interface EntitlementView extends EntitlementRow {
  status: EntitlementStatus;
  redemptions: Redemption[];
}

/** Revoked beats used beats expired: the operator's act is what they look for. */
export function entitlementStatus(row: Pick<EntitlementRow, "revoked_at" | "used" | "quantity" | "expires_at">, now = Date.now()): EntitlementStatus {
  if (row.revoked_at) return "revoked";
  if (row.used >= row.quantity) return "used";
  if (Date.parse(row.expires_at) <= now) return "expired";
  return "unused";
}

// --- The console: mint, list, revoke ----------------------------------------

export interface MintInput {
  note: string | null;
  days: number;
}

export function parseMintInput(body: unknown): MintInput {
  const b = (body ?? {}) as { note?: unknown; days?: unknown };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  let days = DEFAULT_INVITE_DAYS;
  if (b.days !== undefined && b.days !== null && b.days !== "") {
    days = Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
      throw new EntitlementError(`A code lasts from 1 to ${MAX_INVITE_DAYS} days.`);
    }
  }
  return { note: note || null, days };
}

/** Mint an invite code for one hub. Returns the code, which is never stored. */
export async function mintInvite(input: MintInput, actor: string): Promise<{ code: string; entitlement: EntitlementView }> {
  const code = generateInviteCode();
  const normalized = normalizeInviteCode(code)!;
  const row = {
    id: generateId("ent"),
    kind: "hub.create" satisfies EntitlementKind,
    quantity: 1,
    used: 0,
    source: "invite" satisfies EntitlementSource,
    code_hash: hashInviteCode(normalized),
    code_hint: normalized.slice(-4),
    note: input.note,
    created_by: actor,
    expires_at: new Date(Date.now() + input.days * 24 * 60 * 60 * 1000).toISOString(),
  };
  const { data, error } = await getDb().from("entitlements").insert(row).select(COLUMNS).single();
  if (error) throw new Error(`entitlements write failed: ${error.message}`);
  const saved = data as EntitlementRow;
  return { code, entitlement: { ...saved, status: entitlementStatus(saved), redemptions: [] } };
}

export async function listEntitlements(limit = 200): Promise<EntitlementView[]> {
  const db = getDb();
  const { data, error } = await db
    .from("entitlements")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`entitlements read failed: ${error.message}`);
  const rows = (data ?? []) as EntitlementRow[];
  const byId = new Map<string, Redemption[]>();
  if (rows.length > 0) {
    const { data: used, error: usedErr } = await db
      .from("entitlement_redemptions")
      .select("entitlement_id, email, created_hub_id, at")
      .in("entitlement_id", rows.map((r) => r.id))
      .order("at", { ascending: true });
    if (usedErr) throw new Error(`entitlement_redemptions read failed: ${usedErr.message}`);
    for (const r of (used ?? []) as Array<{ entitlement_id: string; email: string; created_hub_id: string | null; at: string }>) {
      const list = byId.get(r.entitlement_id) ?? [];
      list.push({ email: r.email, hub_id: r.created_hub_id, at: r.at });
      byId.set(r.entitlement_id, list);
    }
  }
  const now = Date.now();
  return rows.map((r) => ({ ...r, status: entitlementStatus(r, now), redemptions: byId.get(r.id) ?? [] }));
}

export async function getEntitlement(id: string): Promise<EntitlementRow | null> {
  const { data, error } = await getDb().from("entitlements").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`entitlements read failed: ${error.message}`);
  return (data as EntitlementRow | null) ?? null;
}

/**
 * Revoke an entitlement that has not been used up. A start-page session
 * opened with it can no longer create (the claim refuses a revoked row).
 */
export async function revokeEntitlement(id: string, actor: string): Promise<{ before: EntitlementRow; after: EntitlementRow }> {
  const before = await getEntitlement(id);
  if (!before) throw new EntitlementError("No such code.", 404);
  if (before.revoked_at) throw new EntitlementError("This code is already revoked.");
  if (before.used >= before.quantity) throw new EntitlementError("This code has been used; there is nothing left to revoke.");
  const { data, error } = await getDb()
    .from("entitlements")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actor })
    .eq("id", id)
    .is("revoked_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`entitlements write failed: ${error.message}`);
  if (!data) throw new EntitlementError("This code changed while you were looking at it. Reload the list.", 409);
  return { before, after: data as EntitlementRow };
}

// --- The start page: check, claim, redeem ------------------------------------

/** Usable right now? Not revoked, not used up, not expired, of the kind asked for. */
function usable(row: EntitlementRow, kind: EntitlementKind, now = Date.now()): boolean {
  return row.kind === kind && entitlementStatus(row, now) === "unused";
}

/**
 * The entitlement a typed invite code grants, or INVITE_REFUSED for every
 * reason it does not: malformed, unknown, used, expired or revoked.
 */
export async function checkInviteCode(raw: unknown, kind: EntitlementKind = "hub.create"): Promise<EntitlementRow> {
  const normalized = normalizeInviteCode(raw);
  if (!normalized) throw new EntitlementError(INVITE_REFUSED, 403);
  const { data, error } = await getDb()
    .from("entitlements")
    .select(COLUMNS)
    .eq("code_hash", hashInviteCode(normalized))
    .maybeSingle();
  if (error) throw new Error(`entitlements read failed: ${error.message}`);
  const row = data as EntitlementRow | null;
  if (!row || !usable(row, kind)) throw new EntitlementError(INVITE_REFUSED, 403);
  return row;
}

/** Is this entitlement still usable (the start page re-checks before each step)? */
export async function entitlementStillUsable(id: string, kind: EntitlementKind = "hub.create"): Promise<boolean> {
  const row = await getEntitlement(id);
  return row !== null && usable(row, kind);
}

/**
 * Hold the entitlement for a create. One conditional update: of two callers,
 * one gets the row and the other gets INVITE_REFUSED. A hold left by a
 * create that died lapses after CLAIM_MS.
 */
export async function claimEntitlement(id: string, email: string): Promise<EntitlementRow> {
  const row = await getEntitlement(id);
  if (!row || !usable(row, "hub.create")) throw new EntitlementError(INVITE_REFUSED, 403);
  const now = new Date();
  const { data, error } = await getDb()
    .from("entitlements")
    .update({ claimed_until: new Date(now.getTime() + CLAIM_MS).toISOString(), claimed_by: email })
    .eq("id", id)
    .eq("used", row.used)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .or(`claimed_until.is.null,claimed_until.lt.${now.toISOString()}`)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`entitlements claim failed: ${error.message}`);
  if (!data) throw new EntitlementError(INVITE_REFUSED, 403);
  return data as EntitlementRow;
}

/** A create failed: the entitlement is unused again. */
export async function releaseClaim(id: string, email: string): Promise<void> {
  const { error } = await getDb()
    .from("entitlements")
    .update({ claimed_until: null, claimed_by: null })
    .eq("id", id)
    .eq("claimed_by", email);
  if (error) console.error(`[start] releasing the claim on ${id} failed: ${error.message}`);
}

/** The hub exists: record the use, count it, release the hold. */
export async function redeemEntitlement(claimed: EntitlementRow, email: string, hubId: string): Promise<EntitlementRow> {
  const db = getDb();
  const { error: logErr } = await db
    .from("entitlement_redemptions")
    .insert({ entitlement_id: claimed.id, email, created_hub_id: hubId });
  if (logErr) throw new Error(`entitlement_redemptions write failed: ${logErr.message}`);
  const { data, error } = await db
    .from("entitlements")
    .update({ used: claimed.used + 1, claimed_until: null, claimed_by: null })
    .eq("id", claimed.id)
    .eq("used", claimed.used)
    .select(COLUMNS)
    .maybeSingle();
  if (error || !data) throw new Error(`entitlements redeem failed: ${error?.message ?? "the row changed during the create"}`);
  return data as EntitlementRow;
}
