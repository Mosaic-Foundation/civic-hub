// Officials service — read/write for the admin-managed official role.
//
// An official is an ACCOUNT (users.official_type + users.official_title),
// not an email in a config blob. This module owns every read and write of
// those two columns.
//
// WHY id-keyed: the title has to render next to the person wherever they
// post — comments, proposals, projects, votes, announcements — and every
// one of those surfaces resolves an author by user id, not by email. The
// previous email-keyed hub_settings.announcement_authors list could only
// ever reach announcements, because that was the one place the email was
// in hand at write time.
//
// The ADMIN still types an EMAIL, because the hub has no user-directory
// endpoint to pick from. Designating an email with no account yet creates
// a shell users row the same way civic.auth's verifyCode does; unique(email)
// means that person's first sign-in adopts the very same row. This
// preserves the operator's ability to pre-authorize a board member before
// they have ever signed in.

import { getDb } from "../db/client.js";
import { generateId } from "../utils/id.js";
import {
  areOfficialsMigrated,
  getAnnouncementAuthors,
  setOfficialsMigrated,
} from "./hubSettings.js";
import {
  type OfficialIdentity,
  type OfficialType,
  inferOfficialType,
  normalizeOfficialType,
  toOfficialIdentity,
} from "../shared/officialTypes.js";

/** One row of the admin panel's Officials table. */
export interface OfficialRecord {
  email: string;
  /** Admin-curated display name. Written to users.display_name. */
  name: string | null;
  official_type: OfficialType;
  official_title: string;
}

interface OfficialUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  full_name: string | null;
  official_type: string | null;
  official_title: string | null;
}

/**
 * Every account currently designated an official, for the admin panel.
 * Ordered by title so the list reads as a roster.
 */
export async function listOfficials(): Promise<OfficialRecord[]> {
  const { data, error } = await getDb()
    .from("users")
    .select("*")
    .not("official_type", "is", null)
    .order("official_title", { ascending: true });
  if (error) {
    // A database that has not applied the official-role migration has no
    // such column to filter on. Degrade to an empty roster so the admin
    // settings page still loads (and still shows the legacy list beneath)
    // instead of 500-ing on every setting it holds.
    console.error(`[officials] list failed, returning empty roster: ${error.message}`);
    return [];
  }

  const out: OfficialRecord[] = [];
  for (const row of (data ?? []) as OfficialUserRow[]) {
    const identity = toOfficialIdentity(row.official_type, row.official_title);
    if (!identity || !row.email) continue;
    out.push({
      email: row.email,
      name: row.display_name?.trim() || null,
      official_type: identity.type,
      official_title: identity.title,
    });
  }
  return out;
}

/**
 * The roster as the ADMIN PANEL should show it: the managed officials,
 * plus any legacy hub_settings.announcement_authors entry that has not
 * been migrated onto a user row yet.
 *
 * Merging here makes the panel self-migrating — an operator who opens
 * Officials sees everyone who can currently post, and saving writes them
 * all onto user rows and retires the legacy list. The seed script does
 * the same thing headlessly for an environment nobody has opened.
 */
export async function listOfficialsWithLegacy(): Promise<OfficialRecord[]> {
  const managed = await listOfficials();
  if (await areOfficialsMigrated()) return managed;

  const seen = new Set(managed.map((o) => o.email.toLowerCase()));
  const merged = [...managed];
  for (const legacy of await getAnnouncementAuthors()) {
    const email = legacy.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    merged.push({
      email,
      name: legacy.name?.trim() || null,
      official_type: inferOfficialType(legacy.label),
      official_title: legacy.label,
    });
  }
  return merged;
}

/**
 * Look up an account's official identity by EMAIL. Used by the auth
 * middleware, which knows the signed-in user's email.
 * Returns null for residents and for unknown emails.
 */
export async function lookupOfficialByEmail(
  email: string | undefined | null,
): Promise<OfficialIdentity | null> {
  if (!email) return null;
  // select("*") rather than naming the two columns, for the same reason
  // creatorDisplay does it: naming a column a pre-migration database does
  // not have is a hard error, where "*" simply returns what exists.
  const { data, error } = await getDb()
    .from("users")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) {
    // A DB that has not applied the migration must not lock officials —
    // or anyone else — out of posting. Degrade to "not an official" and
    // let the caller fall through to its next resolution tier.
    console.error(`[officials] lookup failed, treating as resident: ${error.message}`);
    return null;
  }
  const row = data as { official_type?: unknown; official_title?: unknown } | null;
  if (!row) return null;
  return toOfficialIdentity(row.official_type, row.official_title);
}

/**
 * Replace the full officials roster.
 *
 * Set semantics, mirroring how the admin panel presents it: accounts in
 * `records` become (or stay) officials; any account currently official
 * and ABSENT from `records` is demoted. Demotion clears the two columns
 * only — it never deletes an account or touches anything else the person
 * has posted.
 *
 * Returns the roster as stored.
 */
export async function setOfficials(
  records: unknown[],
  updatedBy: string | null,
): Promise<OfficialRecord[]> {
  const cleaned = normalizeOfficialRecords(records);
  const db = getDb();

  // Resolve every listed email to a user id, creating shell rows as needed.
  const keep = new Set<string>();
  for (const record of cleaned) {
    const userId = await findOrCreateUserByEmail(record.email);
    keep.add(userId);

    const patch: Record<string, unknown> = {
      official_type: record.official_type,
      official_title: record.official_title,
    };
    // The admin-curated name is the operator's control over how this
    // person appears before they have filled in their own account. Write
    // it only when supplied; blank means "use whatever they have set".
    if (record.name) patch.display_name = record.name;

    const { error } = await db.from("users").update(patch).eq("id", userId);
    if (error) throw new Error(`officials.set(${record.email}): ${error.message}`);
  }

  // Demote anyone dropped from the list.
  const { data: current, error: curErr } = await db
    .from("users")
    .select("id")
    .not("official_type", "is", null);
  if (curErr) throw new Error(`officials.set: ${curErr.message}`);
  const demote = ((current ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (demote.length > 0) {
    const { error } = await db
      .from("users")
      .update({ official_type: null, official_title: null })
      .in("id", demote);
    if (error) throw new Error(`officials.set(demote): ${error.message}`);
  }

  // An explicit save from the admin panel IS the roster. Latch the
  // migration so the legacy list stops re-granting anyone the operator
  // just removed — without this, demotion silently un-does itself on the
  // next request.
  await setOfficialsMigrated(updatedBy);

  return listOfficials();
}

/**
 * Find a user id by email, creating a shell account when none exists.
 *
 * The shell mirrors civic.auth's verifyCode insert with
 * email_verified: false — the person has not proved the address yet;
 * their first OTP sign-in flips it and reuses this row (matched on the
 * unique email index). It is deliberately NOT is_resident: designating
 * someone an official is not an affirmation of residency on their behalf.
 */
async function findOrCreateUserByEmail(email: string): Promise<string> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();

  const { data: existing, error: selErr } = await db
    .from("users")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  if (selErr) throw new Error(`officials.findOrCreate: ${selErr.message}`);
  if (existing) return (existing as { id: string }).id;

  const row = {
    id: generateId("user"),
    email: normalized,
    email_verified: false,
    is_resident: false,
    digest_frequency_days: 1,
  };
  const { data, error } = await db.from("users").insert(row).select("id").single();
  if (error) {
    // 23505 = unique_violation — a concurrent sign-in created it first.
    if (error.code === "23505") {
      const { data: refetch, error: refErr } = await db
        .from("users")
        .select("id")
        .eq("email", normalized)
        .single();
      if (refErr) throw new Error(`officials.findOrCreate: ${refErr.message}`);
      return (refetch as { id: string }).id;
    }
    throw new Error(`officials.findOrCreate: ${error.message}`);
  }
  console.log(`[officials] shell account created for ${normalized}`);
  return (data as { id: string }).id;
}

/**
 * Trim, drop incomplete rows, dedupe by lowercased email. Preserves
 * caller order. Exported for unit tests — this is the validation the
 * admin PATCH relies on.
 */
export function normalizeOfficialRecords(raw: unknown[]): OfficialRecord[] {
  const seen = new Set<string>();
  const out: OfficialRecord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      email?: unknown;
      name?: unknown;
      official_type?: unknown;
      official_title?: unknown;
    };
    const email = typeof e.email === "string" ? e.email.trim().toLowerCase() : "";
    if (!email) continue;
    const identity = toOfficialIdentity(e.official_type, e.official_title);
    // A row with no title is not an official — the title is the half that
    // renders. Silently dropping it here matches the DB's both-or-neither
    // CHECK rather than fighting it.
    if (!identity) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const name = typeof e.name === "string" ? e.name.trim() : "";
    out.push({
      email,
      name: name.length > 0 ? name : null,
      official_type: identity.type,
      official_title: identity.title,
    });
  }
  return out;
}

/** Re-exported for callers that only need the narrowing helper. */
export { normalizeOfficialType };
