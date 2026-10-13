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

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * A session row as the server writes it since Audit 2: the token's SHA-256,
 * and how it was proved. A minted session stands for a code sign-in.
 */
async function insertSession(hubId: string, userId: string, assurance: "code" | "demo" = "code"): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await rest("sessions", {
    method: "POST",
    body: JSON.stringify({
      token: sha256(token),
      user_id: userId,
      hub_id: hubId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      assurance,
    }),
  });
  return token;
}

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

const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function localStack(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL?.trim() || "http://127.0.0.1:54321").replace(/\/$/, "");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `adminSession: refusing to write a session into ${host}. ` +
        "This fixture runs against the local Supabase stack only.",
    );
  }
  return { url, key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || LOCAL_SERVICE_ROLE_KEY };
}

/** A PostgREST call against the LOCAL stack, as the service role. */
export async function localRest(path: string, init: RequestInit = {}): Promise<unknown> {
  return rest(path, init);
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const { url, key } = localStack();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`adminSession: ${path} ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * A session token for `email` on `hubId`. Creates the user if needed.
 * Whether that session is an ADMIN one is up to the hub's roster, which is
 * the point: the test proves the server's decision, not the fixture's.
 */
export async function mintSession(hubId: string, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  // Accounts belong to a hub since Phase 2a: look up, and create, the user
  // on the hub the session is for.
  const found = (await rest(
    `users?select=id&hub_id=eq.${encodeURIComponent(hubId)}&email=eq.${encodeURIComponent(normalized)}`,
  )) as Array<{ id: string }>;

  let userId = found[0]?.id;
  if (!userId) {
    userId = `user_${randomBytes(8).toString("hex")}`;
    await rest("users", {
      method: "POST",
      body: JSON.stringify({
        id: userId,
        hub_id: hubId,
        email: normalized,
        email_verified: true,
        is_resident: true,
        full_name: "Settings Test Admin",
      }),
    });
  }

  return insertSession(hubId, userId);
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
