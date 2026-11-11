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
//
// Kept in the console's own schema (console.entitlements, console.
// entitlement_links, console.entitlement_redemptions), as civic_console
// (./db.ts; the console split, step 3b).

import { CivicError, codeForStatus } from "../errors/index.js";
import { createHash, randomInt } from "node:crypto";
import { q } from "./db.js";
import { randomToken, sha256Hex } from "../utils/hash.js";
import { generateId } from "../utils/id.js";
import { PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";

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

export class EntitlementError extends CivicError {
  constructor(message: string, status = 400) {
    super(status, codeForStatus(status), message);
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

const TIME_COLUMNS = ["created_at", "expires_at", "revoked_at", "claimed_until"] as const;

/** A row as Postgres returns it (timestamps as Date) → the shape the console sends. */
function asRow(raw: Record<string, unknown>): EntitlementRow {
  const out: Record<string, unknown> = { ...raw };
  for (const k of TIME_COLUMNS) out[k] = iso(raw[k]);
  return out as unknown as EntitlementRow;
}

function iso(v: unknown): string | null {
  return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
}

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

/** The address and code the console sends an invite with. */
export function parseSendInvite(body: unknown): { email: string; code: string } {
  const b = (body ?? {}) as { email?: unknown; code?: unknown };
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email)) throw new EntitlementError("Enter one email address.");
  return { email, code: typeof b.code === "string" ? b.code : "" };
}

/** Mint an invite code for one hub. Returns the code, which is never stored. */
export async function mintInvite(input: MintInput, actor: string): Promise<{ code: string; entitlement: EntitlementView }> {
  const code = generateInviteCode();
  const normalized = normalizeInviteCode(code)!;
  const { rows } = await q(
    `INSERT INTO console.entitlements (id, kind, quantity, used, source, code_hash, code_hint, note, created_by, expires_at)
     VALUES ($1, $2, 1, 0, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      generateId("ent"),
      "hub.create" satisfies EntitlementKind,
      "invite" satisfies EntitlementSource,
      hashInviteCode(normalized),
      normalized.slice(-4),
      input.note,
      actor,
      new Date(Date.now() + input.days * 24 * 60 * 60 * 1000).toISOString(),
    ],
  );
  const saved = asRow(rows[0]!);
  return { code, entitlement: { ...saved, status: entitlementStatus(saved), redemptions: [] } };
}

export async function listEntitlements(limit = 200): Promise<EntitlementView[]> {
  const { rows: raw } = await q(`SELECT ${COLUMNS} FROM console.entitlements ORDER BY created_at DESC LIMIT $1`, [
    Math.min(Math.max(limit, 1), 500),
  ]);
  const rows = raw.map(asRow);
  const byId = new Map<string, Redemption[]>();
  if (rows.length > 0) {
    const { rows: used } = await q<{ entitlement_id: string; email: string; created_hub_id: string | null; at: unknown }>(
      `SELECT entitlement_id, email, created_hub_id, at FROM console.entitlement_redemptions
        WHERE entitlement_id = ANY($1::text[]) ORDER BY at ASC`,
      [rows.map((r) => r.id)],
    );
    for (const r of used) {
      const list = byId.get(r.entitlement_id) ?? [];
      list.push({ email: r.email, hub_id: r.created_hub_id, at: iso(r.at)! });
      byId.set(r.entitlement_id, list);
    }
  }
  const now = Date.now();
  return rows.map((r) => ({ ...r, status: entitlementStatus(r, now), redemptions: byId.get(r.id) ?? [] }));
}

export async function getEntitlement(id: string): Promise<EntitlementRow | null> {
  const { rows } = await q(`SELECT ${COLUMNS} FROM console.entitlements WHERE id = $1`, [id]);
  return rows[0] ? asRow(rows[0]) : null;
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
  const { rows } = await q(
    `UPDATE console.entitlements SET revoked_at = now(), revoked_by = $2
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, actor],
  );
  if (!rows[0]) throw new EntitlementError("This code changed while you were looking at it. Reload the list.", 409);
  return { before, after: asRow(rows[0]) };
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
  const { rows } = await q(`SELECT ${COLUMNS} FROM console.entitlements WHERE code_hash = $1`, [hashInviteCode(normalized)]);
  const row = rows[0] ? asRow(rows[0]) : null;
  if (!row || !usable(row, kind)) throw new EntitlementError(INVITE_REFUSED, 403);
  return row;
}

// --- An emailed invite's link (pilot readiness 2, 2026-11-02) ------------------

/** The one answer for every link that cannot be used; the start page adds what to do next. */
export const INVITE_LINK_REFUSED = "That link has been used or has expired.";

/** How long an emailed link works (Adam, 2026-11-06): seven days, never past the invite's end. */
export const INVITE_LINK_DAYS = 7;

/** When a link minted now stops working. */
export function inviteLinkExpiry(entitlementExpiresAt: string, now = Date.now()): string {
  return new Date(Math.min(now + INVITE_LINK_DAYS * 86_400_000, Date.parse(entitlementExpiresAt))).toISOString();
}

/**
 * A link for one email of this invite, bound to the address it goes to. The
 * token is shown to the mail only and stored hashed. Each send has its own, so
 * one address's click doesn't spend another's. `refreshed` marks one the
 * invitee asked for from the start page, which the rate limit counts.
 */
export async function createInviteLink(
  entitlement: Pick<EntitlementRow, "id" | "expires_at">,
  email: string,
  opts: { refreshed?: boolean } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = inviteLinkExpiry(entitlement.expires_at);
  await q(
    "INSERT INTO console.entitlement_links (token_hash, entitlement_id, email, expires_at, refreshed) VALUES ($1, $2, $3, $4, $5)",
    [sha256Hex(token), entitlement.id, email, expiresAt, opts.refreshed ?? false],
  );
  return { token, expiresAt };
}

/**
 * What a link that cannot be followed means, for the start page to say
 * (pilot readiness 3):
 *   unknown   no such link;
 *   good      it still works;
 *   spent     followed once already, and the invite is still good;
 *   expired   past its seven days, and the invite is still good;
 *   ended     the invite was revoked or has passed its end date;
 *   redeemed  the invite made a hub; `hub_id` names it when known.
 * Only someone holding the link can ask, and they received the email.
 */
export type InviteLinkState = "unknown" | "good" | "spent" | "expired" | "ended" | "redeemed";

export interface InviteLinkLookup {
  state: InviteLinkState;
  email: string | null;
  entitlement: EntitlementRow | null;
  hub_id: string | null;
}

export async function inviteLinkState(raw: unknown, now = Date.now()): Promise<InviteLinkLookup> {
  const none: InviteLinkLookup = { state: "unknown", email: null, entitlement: null, hub_id: null };
  if (typeof raw !== "string" || !raw || raw.length > 128) return none;
  const { rows: links } = await q<{ entitlement_id: string; email: string; expires_at: unknown; spent_at: unknown }>(
    "SELECT entitlement_id, email, expires_at, spent_at FROM console.entitlement_links WHERE token_hash = $1",
    [sha256Hex(raw)],
  );
  const found0 = links[0];
  if (!found0) return none;
  const link = { ...found0, expires_at: iso(found0.expires_at)!, spent_at: iso(found0.spent_at) };
  const entitlement = await getEntitlement(link.entitlement_id);
  if (!entitlement) return none;
  const found = { email: link.email, entitlement, hub_id: null };
  const status = entitlementStatus(entitlement, now);
  if (status === "used") {
    const { rows: made } = await q<{ created_hub_id: string }>(
      `SELECT created_hub_id FROM console.entitlement_redemptions
        WHERE entitlement_id = $1 AND created_hub_id IS NOT NULL ORDER BY at DESC LIMIT 1`,
      [entitlement.id],
    );
    return { ...found, state: "redeemed", hub_id: made[0]?.created_hub_id ?? null };
  }
  if (status !== "unused") return { ...found, state: "ended" };
  if (link.spent_at) return { ...found, state: "spent" };
  if (Date.parse(link.expires_at) <= now) return { ...found, state: "expired" };
  return { ...found, state: "good" };
}

/** The rate limit on fresh links (Adam, 2026-11-06), per invite. */
export const FRESH_LINK_PER_MINUTE = 1;
export const FRESH_LINK_PER_DAY = 3;
export const FRESH_LINK_TOO_SOON = "A fresh link was just sent. Check your email, or ask again in a minute.";
export const FRESH_LINK_DAILY_LIMIT = `Three fresh links have been sent today. Use the newest one, wait until tomorrow, or write to ${PLATFORM_CONTACT_EMAIL}.`;

/**
 * May this invite have another fresh link now? Throws, with the words to show,
 * when it may not. Counts only links the invitee asked for.
 */
export async function checkFreshLinkLimit(entitlementId: string, now = Date.now()): Promise<void> {
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const { rows } = await q<{ created_at: unknown }>(
    "SELECT created_at FROM console.entitlement_links WHERE entitlement_id = $1 AND refreshed AND created_at > $2",
    [entitlementId, dayAgo],
  );
  const times = rows.map((r) => Date.parse(iso(r.created_at)!));
  if (times.filter((t) => t > now - 60_000).length >= FRESH_LINK_PER_MINUTE) throw new EntitlementError(FRESH_LINK_TOO_SOON, 429);
  if (times.length >= FRESH_LINK_PER_DAY) throw new EntitlementError(FRESH_LINK_DAILY_LIMIT, 429);
}

/**
 * Spend a link: one conditional update, so of two followers one gets the row.
 * Refused, with one answer, when it is unknown, spent or expired, or its code
 * can no longer be used; a refused follow does not spend it.
 */
export async function spendInviteLink(raw: unknown): Promise<{ entitlement_id: string; email: string }> {
  const refused = new EntitlementError(INVITE_LINK_REFUSED, 403);
  if (typeof raw !== "string" || !raw || raw.length > 128) throw refused;
  const hash = sha256Hex(raw);
  const { rows: found } = await q<{ entitlement_id: string }>("SELECT entitlement_id FROM console.entitlement_links WHERE token_hash = $1", [hash]);
  if (!found[0] || !(await entitlementStillUsable(found[0].entitlement_id))) throw refused;
  const { rows } = await q<{ entitlement_id: string; email: string }>(
    `UPDATE console.entitlement_links SET spent_at = now()
      WHERE token_hash = $1 AND spent_at IS NULL AND expires_at > now()
      RETURNING entitlement_id, email`,
    [hash],
  );
  if (!rows[0]) throw refused;
  return rows[0];
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
  const { rows } = await q(
    `UPDATE console.entitlements SET claimed_until = $2, claimed_by = $3
      WHERE id = $1 AND used = $4 AND revoked_at IS NULL AND expires_at > $5
        AND (claimed_until IS NULL OR claimed_until < $5)
      RETURNING ${COLUMNS}`,
    [id, new Date(now.getTime() + CLAIM_MS).toISOString(), email, row.used, now.toISOString()],
  );
  if (!rows[0]) throw new EntitlementError(INVITE_REFUSED, 403);
  return asRow(rows[0]);
}

/** A create failed: the entitlement is unused again. */
export async function releaseClaim(id: string, email: string): Promise<void> {
  try {
    await q("UPDATE console.entitlements SET claimed_until = NULL, claimed_by = NULL WHERE id = $1 AND claimed_by = $2", [id, email]);
  } catch (err) {
    console.error(`[start] releasing the claim on ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The hub exists: record the use, count it, release the hold. */
export async function redeemEntitlement(claimed: EntitlementRow, email: string, hubId: string): Promise<EntitlementRow> {
  await q("INSERT INTO console.entitlement_redemptions (entitlement_id, email, created_hub_id) VALUES ($1, $2, $3)", [
    claimed.id,
    email,
    hubId,
  ]);
  const { rows } = await q(
    `UPDATE console.entitlements SET used = $3, claimed_until = NULL, claimed_by = NULL
      WHERE id = $1 AND used = $2
      RETURNING ${COLUMNS}`,
    [claimed.id, claimed.used, claimed.used + 1],
  );
  if (!rows[0]) throw new Error("entitlements redeem failed: the row changed during the create");
  return asRow(rows[0]);
}
