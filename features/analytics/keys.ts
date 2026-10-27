// Reporting keys (ADR-016): a hub admin issues one to a named outside
// organisation (name, contact, purpose), which then reads /analytics even
// while public numbers are off. Only sha256 of the key is kept, with its last
// four characters to tell keys apart; the key itself is shown once. Every read
// with a key is logged (organisation, time, period), append-only; a revoked
// key reads nothing.

import { createHash, randomBytes } from "node:crypto";
import { generateId, ValidationError, NotFoundError, type FeatureHost } from "../../src/sdk/index.js";
import type { Period } from "./periods.js";

const PREFIX = "csr_";
const KEY_SHAPE = /^csr_[A-Za-z0-9_-]{43}$/;

export interface ReportKey {
  id: string;
  organisation: string;
  contact: string;
  purpose: string;
  key_hint: string;
  created_at: string;
  revoked_at: string | null;
}

export interface ReportRead {
  key_id: string;
  organisation: string;
  read_at: string;
  period_kind: string;
  period_start: string;
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

function field(body: Record<string, unknown>, name: string, max: number): string {
  const v = typeof body[name] === "string" ? (body[name] as string).trim() : "";
  if (v === "") throw new ValidationError(`${name} is required`);
  if (v.length > max) throw new ValidationError(`${name} must be at most ${max} characters`);
  return v;
}

/** Issue a key; the returned `key` is the only time it is seen. */
export async function issueKey(host: FeatureHost, body: Record<string, unknown>, by: string): Promise<ReportKey & { key: string }> {
  const organisation = field(body, "organisation", 200);
  const contact = field(body, "contact", 200);
  const purpose = field(body, "purpose", 1000);
  const key = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = {
    id: generateId("rk"),
    organisation,
    contact,
    purpose,
    key_hash: hash(key),
    key_hint: key.slice(-4),
    created_by: by,
  };
  const [saved] = await host.db().from("analytics_report_keys").insert(row).select<ReportKey>(
    "id, organisation, contact, purpose, key_hint, created_at, revoked_at",
  );
  return { ...saved, key };
}

export async function listKeys(host: FeatureHost): Promise<ReportKey[]> {
  return host
    .db()
    .from("analytics_report_keys")
    .select<ReportKey>("id, organisation, contact, purpose, key_hint, created_at, revoked_at")
    .order("created_at", { ascending: false })
    .limit(200);
}

export async function revokeKey(host: FeatureHost, id: string, by: string): Promise<ReportKey> {
  const rows = await host
    .db()
    .from("analytics_report_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: by })
    .eq("id", id)
    .is("revoked_at", null)
    .select<ReportKey>("id, organisation, contact, purpose, key_hint, created_at, revoked_at");
  if (rows.length === 0) throw new NotFoundError("No such key, or it was already revoked");
  return rows[0];
}

/** The live key a request presents, or null for none; "refused" for one that is malformed, unknown or revoked. */
export async function keyOfRequest(host: FeatureHost, authorization: string | undefined): Promise<ReportKey | "refused" | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m || !m[1].startsWith(PREFIX)) return null;
  if (!KEY_SHAPE.test(m[1])) return "refused";
  const row = await host
    .db()
    .from("analytics_report_keys")
    .select<ReportKey>("id, organisation, contact, purpose, key_hint, created_at, revoked_at")
    .eq("key_hash", hash(m[1]))
    .maybeSingle();
  return row && !row.revoked_at ? row : "refused";
}

export async function logRead(host: FeatureHost, key: ReportKey, period: Period): Promise<void> {
  await host.db().from("analytics_report_reads").insert({
    key_id: key.id,
    organisation: key.organisation,
    period_kind: period.kind,
    period_start: period.start,
  });
}

export async function listReads(host: FeatureHost): Promise<ReportRead[]> {
  return host
    .db()
    .from("analytics_report_reads")
    .select<ReportRead>("key_id, organisation, read_at, period_kind, period_start")
    .order("read_at", { ascending: false })
    .limit(200);
}
