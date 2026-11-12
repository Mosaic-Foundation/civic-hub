// The hub's operator API (src/operator/), for tests that need a hub made,
// changed or put away the way the console does it. Since the console split
// (2026-11-11) the console is its own deployment (Mosaic-Foundation/
// mosaic-console); a test here exercises the hub's side of each action, not
// the console's sign-in, fresh codes or audit log.
//
// Each helper answers { status, body } like the console's route did: the
// hub's detail on success, { error, code } with the refusal's status.
// Needs the server's CIVIC_OPERATOR_TOKEN to be OPERATOR_TOKEN (CI and the
// local launch configs set it).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OPERATOR, operator, operatorCall, type OperatorResponse } from "../../kit/conformance/src/support/operator.js";
import { TEST_KEY_PUBLIC, parseSigningKey, signRow, type Signature, type SignedFields } from "../../src/shared/catalogSignature.js";

export {
  OPERATOR,
  OPERATOR_TOKEN,
  OperatorRefused,
  createHub,
  operator,
  operatorCall,
  type OperatorResponse,
} from "../../kit/conformance/src/support/operator.js";

/** The hub's detail as the console's hub page shows it (404 when there is no such hub). */
export async function hubDetail(hubId: string): Promise<OperatorResponse> {
  const res = await operatorCall("hubDetail", hubId);
  if (res.status === 200 && res.body === null) return { status: 404, body: { error: "No such hub." } };
  return res;
}

/** A console form's own fields (its fresh code, the browser's zone) are the console's, not the hub's. */
function hubFields(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const { step_up_code: _code, tz: _tz, ...rest } = body as Record<string, unknown>;
  return rest;
}

/** Answer `res` if refused, else the hub's detail with `extra` beside it. */
async function then(hubId: string, res: OperatorResponse, extra: (body: any) => Record<string, unknown> = () => ({})): Promise<OperatorResponse> {
  if (res.status !== 200) return res;
  const detail = await hubDetail(hubId);
  if (detail.status !== 200) return detail;
  return { status: 200, body: { ...detail.body, ...extra(res.body) } };
}

/**
 * The console's Edit hub: check the patch, then apply it (the console's fresh
 * code is the console's). Answers the detail with follow_on, message, and the
 * plan the hub checked (changes, the values before, needs_step_up).
 */
export async function updateHub(hubId: string, patch: Record<string, unknown>, by = OPERATOR): Promise<OperatorResponse> {
  const plan = await operatorCall("planConfig", hubId, hubFields(patch));
  if (plan.status !== 200) return plan;
  if (Object.keys(plan.body.changes).length === 0) return hubDetail(hubId);
  const applied = await operatorCall("applyConfig", hubId, plan.body.changes, by);
  return then(hubId, applied, (b) => ({ follow_on: b.follow_on, message: b.message, plan: plan.body }));
}

/** What residents see while the hub is a demo (the console's Handover card). */
export async function updateHandover(hubId: string, body: unknown, by = OPERATOR): Promise<OperatorResponse> {
  const res = await operatorCall("updateHandover", hubId, hubFields(body), by);
  return then(hubId, res, (b) => ({ follow_on: b.result, message: b.message }));
}

/** The operator's AI limits for a hub. */
export async function updateAiLimits(hubId: string, body: unknown, by = OPERATOR): Promise<OperatorResponse> {
  return then(hubId, await operatorCall("updateAiLimits", hubId, hubFields(body), by));
}

/** A hub's admins, as asked; the new ones are invited. */
export async function setAdmins(hubId: string, body: unknown, by = OPERATOR): Promise<OperatorResponse> {
  const plan = await operatorCall("planAdmins", hubId, hubFields(body));
  if (plan.status !== 200) return plan;
  const { before, next } = plan.body as { before: string[]; next: string[] };
  if (JSON.stringify(before) === JSON.stringify(next)) return hubDetail(hubId);
  const set = await operatorCall("setAdmins", hubId, next, by);
  if (set.status !== 200) return set;
  const invites = await operator<{ report: unknown; message: string | null }>("inviteAdmins", hubId, next.filter((e) => !before.includes(e)));
  return then(hubId, set, () => ({ invites: invites.report, message: invites.message }));
}

/** Refresh a demo or beta hub's samples now: { refresh, titles }. */
export function refreshSamples(hubId: string): Promise<OperatorResponse> {
  return operatorCall("refreshSamples", hubId);
}

/** Archive a hub; answers its detail. */
export async function archiveHub(hubId: string): Promise<OperatorResponse> {
  return then(hubId, await operatorCall("archive", hubId));
}

/** Unarchive a hub; answers its detail. */
export async function unarchiveHub(hubId: string): Promise<OperatorResponse> {
  return then(hubId, await operatorCall("unarchive", hubId));
}

/** Put away hubs a test made (archived, as the console would; the run's teardown deletes them). Never throws. */
export async function archiveHubs(ids: Iterable<string>): Promise<void> {
  for (const id of ids) await operatorCall("archive", id).catch(() => undefined);
}

// --- The plugin catalog (ADR-014, ADR-015) ---
//
// The console signs an approval with its private key; the hub stores the
// signature only if it verifies against a key the deployment trusts. Here the
// committed test key stands in for the console's: CI's server trusts its
// public half (CIVIC_CATALOG_PUBLIC_KEY), and refuses it in production.

const TEST_PEM = readFileSync(fileURLToPath(new URL("./catalog/test-signing-key.pem", import.meta.url)), "utf8");

/** The console's signature over a catalog row, made with the test key. */
export function testSignature(row: SignedFields): Signature {
  return signRow(row, parseSigningKey(TEST_PEM, false));
}

/** The catalog as the hub shows it: entries, what the deployment mounts, the signing state. */
export function catalog(): Promise<any> {
  return operator("catalog");
}

/**
 * Approve an entry as the console does: signed with the test key when the
 * server trusts it (CI), unsigned when the server has no key (a local run,
 * where signatures are not required). Answers the catalog after.
 */
export async function approveEntry(id: string, notes: string | null = null): Promise<OperatorResponse> {
  const view = await catalog();
  const entry = view.entries.find((e: { id: string }) => e.id === id);
  const sign = entry && view.signing.key?.public_key === TEST_KEY_PUBLIC;
  const res = await operatorCall("approveEntry", id, OPERATOR, notes, sign ? testSignature(entry) : null);
  return res.status === 200 ? { status: 200, body: await catalog() } : res;
}

/** Withdraw an entry; answers the catalog after. */
export async function withdrawEntry(id: string, notes: string | null = null): Promise<OperatorResponse> {
  const res = await operatorCall("withdrawEntry", id, OPERATOR, notes);
  return res.status === 200 ? { status: 200, body: await catalog() } : res;
}

/** Mark a version required (or not); answers the catalog after. */
export async function setRequired(id: string, required: boolean): Promise<OperatorResponse> {
  const res = await operatorCall("setRequired", id, required);
  return res.status === 200 ? { status: 200, body: await catalog() } : res;
}

/** "Sign approved entries": every approved entry not signed with the test key, signed; answers what was stored and the catalog after. */
export async function signApproved(): Promise<OperatorResponse> {
  const keyId = parseSigningKey(TEST_PEM, false).id;
  const toSign = (await catalog()).entries.filter(
    (e: SignedFields & { id: string; status: string; signature_key: string | null; signed: boolean }) =>
      e.status === "approved" && (e.signature_key !== keyId || !e.signed),
  );
  const res = await operatorCall("storeSignatures", toSign.map((e: SignedFields & { id: string }) => ({ id: e.id, ...testSignature(e) })));
  return res.status === 200 ? { status: 200, body: { stored: res.body, catalog: await catalog() } } : res;
}
