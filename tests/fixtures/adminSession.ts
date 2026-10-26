// A signed-in admin for tests/api, without an emailed code.
//
// Privileged accounts always get a real emailed code — even on the demo hub —
// and this layer speaks HTTP only, so it cannot receive one. Instead this
// writes a user row and a session row straight into the LOCAL Supabase stack,
// exactly what a successful verify would have written, and hands back the
// token. The server then treats it like any other session: bound to the hub
// it names, admin only if that hub's roster lists the email.
//
// LOCAL ONLY. It refuses any SUPABASE_URL that is not this machine, so a test
// run pointed at a hosted project by mistake fails here instead of minting a
// session in it. The fallback key is the Supabase CLI's fixed local
// service-role key — public, printed by `supabase start` on every machine, and
// already in .github/workflows/ci.yml.

import { createHash, randomBytes } from "node:crypto";
import { insertSession, rest } from "../../kit/conformance/src/support/localStack.js";

// The local stack's PostgREST, sessions and users, as the conformance suite
// reaches them (kit/conformance), shared here with every API test.
export { localRest, localStack, mintSession } from "../../kit/conformance/src/support/localStack.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Put a known sign-in code in place on a hub, as if it had been emailed
 * (stored hashed, as the server stores it), in place of any codes the address
 * already has unless `keepOthers`. `linkToken` gives it a sign-in link too.
 */
export async function plantHubCode(
  hubId: string,
  email: string,
  code: string,
  opts: { attempts?: number; expiresInMs?: number; createdAgoMs?: number; linkToken?: string; keepOthers?: boolean } = {},
): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!opts.keepOthers) {
    await rest(`sign_in_codes?hub_id=eq.${encodeURIComponent(hubId)}&email=eq.${encodeURIComponent(address)}`, { method: "DELETE" });
  }
  await rest("sign_in_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      hub_id: hubId,
      email: address,
      code_hash: sha256(code),
      link_hash: opts.linkToken ? sha256(opts.linkToken) : null,
      expires_at: new Date(Date.now() + (opts.expiresInMs ?? 10 * 60_000)).toISOString(),
      created_at: new Date(Date.now() - (opts.createdAgoMs ?? 60_000)).toISOString(),
      attempts: opts.attempts ?? 0,
    }),
  });
}

/** A demo hub's any-six-digits session for `email` (Audit 2 tests). */
export async function mintDemoSession(hubId: string, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const found = (await rest(
    `users?select=id&hub_id=eq.${encodeURIComponent(hubId)}&email=eq.${encodeURIComponent(normalized)}`,
  )) as Array<{ id: string }>;
  let userId = found[0]?.id;
  if (!userId) {
    userId = `user_${randomBytes(8).toString("hex")}`;
    await rest("users", {
      method: "POST",
      body: JSON.stringify({ id: userId, hub_id: hubId, email: normalized, email_verified: true, is_resident: true, full_name: "Demo Visitor" }),
    });
  }
  return insertSession(hubId, userId, "demo");
}

/**
 * A session row on `hubId` for an existing account, wherever that account
 * lives. For the cross-hub cases: a session whose user belongs to another hub
 * must not authenticate anyone.
 */
export async function mintSessionForUser(hubId: string, userId: string): Promise<string> {
  return insertSession(hubId, userId);
}

/** One hub setting's stored row, read straight from the local stack. */
export async function storedSetting(
  hubId: string,
  key: string,
): Promise<string | undefined> {
  const rows = (await rest(
    `hub_settings?select=value&hub_id=eq.${encodeURIComponent(hubId)}&key=eq.${encodeURIComponent(key)}`,
  )) as Array<{ value: string }>;
  return rows[0]?.value;
}
