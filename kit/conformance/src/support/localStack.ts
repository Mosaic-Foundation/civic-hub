// The local stack, as the suite reaches it where no route shows what a test
// must see or set: PostgREST as the service role, and sessions written as a
// sign-in would write them (a privileged account's real sign-in is an emailed
// code, which a test cannot receive).
//
// LOCAL ONLY. It refuses any SUPABASE_URL that is not this machine. The
// fallback key is the Supabase CLI's fixed local service-role key: public,
// printed by `supabase start` on every machine.

import { createHash, randomBytes } from "node:crypto";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * A session row as the server writes it since Audit 2: the token's SHA-256,
 * and how it was proved. A minted session stands for a code sign-in.
 */
export async function insertSession(hubId: string, userId: string, assurance: "code" | "demo" = "code"): Promise<string> {
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

const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function localStack(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL?.trim() || "http://127.0.0.1:54321").replace(/\/$/, "");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `conformance: refusing to write a session into ${host}. ` +
        "The suite runs against the local Supabase stack only.",
    );
  }
  return { url, key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || LOCAL_SERVICE_ROLE_KEY };
}

/** A PostgREST call against the LOCAL stack, as the service role. */
export async function localRest(path: string, init: RequestInit = {}): Promise<unknown> {
  return rest(path, init);
}

export async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
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
  if (!res.ok) throw new Error(`local stack: ${path} ${res.status} ${text.slice(0, 200)}`);
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
  } else {
    // An account an earlier test made through a real sign-in is a
    // non-resident with no name; the session handed back is always a named
    // resident's, whichever file ran first (vitest orders files by its timing
    // cache, so a crashed run used to reorder the next into ~25 failures).
    await rest(`users?id=eq.${encodeURIComponent(userId)}&is_resident=is.false`, {
      method: "PATCH",
      body: JSON.stringify({ is_resident: true }),
    });
    await rest(`users?id=eq.${encodeURIComponent(userId)}&full_name=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ full_name: "Settings Test Admin" }),
    });
  }

  return insertSession(hubId, userId);
}
