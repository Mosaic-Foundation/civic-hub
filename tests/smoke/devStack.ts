/**
 * The smoke suite's reach into the DEV deployment (release tooling slice,
 * 2026-10-13). The suite runs against the live dev hub after each deploy, as
 * a resident and an admin, so it needs sessions without an emailed code.
 *
 * Adam's decision (2026-10-13): mint sessions straight into the dev database,
 * the way tests/fixtures/adminSession.ts does on the local stack. Nothing is
 * added to src/: no test-only sign-in route ships to production. The cost is
 * the dev project's service-role key in GitHub's secrets; the production key
 * never goes there.
 *
 * Guards, each refusing before anything is written:
 *   - the Supabase URL must be the DEV project's (or the local stack); the production ref
 *     anywhere in it is refused outright;
 *   - the hub must be the configured smoke hub, its slug must start with
 *     "smoke", the deployment at the base URL must serve that hub, and the hub
 *     must be in beta. So a typo in a variable can't point the suite at a hub
 *     people use, or at a demo hub.
 *
 * Configuration (all required; the workflow skips with a message when any is
 * missing; locally, export them before `npm run test:smoke`):
 *   CIVIC_SMOKE_BASE_URL        the smoke hub's address, e.g. https://<slug>.dev.civic.social
 *   CIVIC_SMOKE_HUB             its slug
 *   CIVIC_SMOKE_ADMIN_EMAIL     an address on its admin roster
 *   CIVIC_SMOKE_SUPABASE_URL    https://<dev ref>.supabase.co
 *   CIVIC_SMOKE_SERVICE_ROLE_KEY  the dev project's service-role key (secret)
 */

import { createHash, randomBytes } from "node:crypto";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";

const DEV_REF = "urfmvqhzmamigssqwsya";
const PRODUCTION_REF = "nfhyypwoporfggqcerli";

export const SMOKE_ENV = [
  "CIVIC_SMOKE_BASE_URL",
  "CIVIC_SMOKE_HUB",
  "CIVIC_SMOKE_ADMIN_EMAIL",
  "CIVIC_SMOKE_SUPABASE_URL",
  "CIVIC_SMOKE_SERVICE_ROLE_KEY",
] as const;

export function missingSmokeEnv(): string[] {
  return SMOKE_ENV.filter((k) => !process.env[k]?.trim());
}

function read(name: (typeof SMOKE_ENV)[number]): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`smoke: ${name} is not set (see tests/smoke/devStack.ts)`);
  return v;
}

export const baseUrl = () => read("CIVIC_SMOKE_BASE_URL").replace(/\/$/, "");
export const apiBase = () => `${baseUrl()}/api`;
export const smokeHub = () => read("CIVIC_SMOKE_HUB");
export const adminEmail = () => read("CIVIC_SMOKE_ADMIN_EMAIL").toLowerCase();

function devDb(): { url: string; key: string } {
  const url = read("CIVIC_SMOKE_SUPABASE_URL").replace(/\/$/, "");
  if (url.includes(PRODUCTION_REF)) {
    throw new Error("smoke: refusing the PRODUCTION Supabase project. The smoke suite writes to dev only.");
  }
  // The local stack is allowed too, so the suite can be proven before CI
  // runs it (TESTING.md → Smoke suite → Running it locally).
  const local = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  if (!local && url !== `https://${DEV_REF}.supabase.co`) {
    throw new Error(`smoke: refusing ${url}. The smoke suite writes only to the dev project (${DEV_REF}).`);
  }
  return { url, key: read("CIVIC_SMOKE_SERVICE_ROLE_KEY") };
}

/** A PostgREST call against the DEV project, as the service role. */
export async function devRest(path: string, init: RequestInit = {}): Promise<unknown> {
  const { url, key } = devDb();
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
  if (!res.ok) throw new Error(`smoke: ${path.split("?")[0]} ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Refuse unless the deployment and the database agree this is the smoke hub,
 * in beta. Run once, before the first write (playwright's globalSetup).
 */
export async function assertSmokeHub(): Promise<void> {
  const hub = smokeHub();
  if (!/^smoke[a-z0-9-]*$/.test(hub)) {
    throw new Error(`smoke: CIVIC_SMOKE_HUB is "${hub}". The smoke hub's slug must start with "smoke".`);
  }
  const res = await fetch(`${apiBase()}/hub-config`);
  if (!res.ok) throw new Error(`smoke: ${apiBase()}/hub-config answered ${res.status}`);
  const served = ((await res.json()) as { hub?: { id?: string } }).hub?.id;
  if (served !== hub) {
    throw new Error(`smoke: ${baseUrl()} serves hub "${served}", not "${hub}". Check CIVIC_SMOKE_BASE_URL.`);
  }
  const rows = (await devRest(`hubs?select=id,mode&id=eq.${encodeURIComponent(hub)}`)) as Array<{ mode: string }>;
  if (rows.length !== 1) throw new Error(`smoke: no hub "${hub}" in the dev database.`);
  if (rows[0].mode !== "beta") {
    throw new Error(`smoke: hub "${hub}" is in ${rows[0].mode}; the suite needs it in beta (submissions wait for an admin).`);
  }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Every session this run minted, by token hash, so cleanup can end them. */
const minted: string[] = [];

/**
 * A session for `email` on the smoke hub, as a successful code sign-in would
 * write it, with the current terms accepted (else a dialog covers the page).
 * Creates the account if needed. Admin or not is the hub's roster's decision.
 */
export async function mintSession(email: string): Promise<{ token: string; userId: string }> {
  const hub = smokeHub();
  const normalized = email.trim().toLowerCase();
  const filter = `users?hub_id=eq.${encodeURIComponent(hub)}&email=eq.${encodeURIComponent(normalized)}`;
  let [user] = (await devRest(`${filter}&select=id`)) as Array<{ id: string }>;
  if (!user) {
    user = { id: `user_${randomBytes(8).toString("hex")}` };
    await devRest("users", {
      method: "POST",
      body: JSON.stringify({
        id: user.id,
        hub_id: hub,
        email: normalized,
        email_verified: true,
        is_resident: true,
        full_name: "Smoke Test",
      }),
    });
  }
  await devRest(filter, { method: "PATCH", body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }) });

  const token = randomBytes(32).toString("base64url");
  await devRest("sessions", {
    method: "POST",
    body: JSON.stringify({
      token: sha256(token),
      user_id: user.id,
      hub_id: hub,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      assurance: "code",
    }),
  });
  minted.push(sha256(token));
  return { token, userId: user.id };
}

/** End every session this run minted (the residents' go with their accounts). */
export async function endMintedSessions(): Promise<void> {
  for (const hash of minted.splice(0)) {
    await devRest(`sessions?token=eq.${hash}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/**
 * A sign-in code with its link, on the smoke hub, as a request would store it
 * and email it (sign-in slice, 2026-10-14). Returns the link's token: the
 * suite signs in through the email's link page, not only by minting a
 * session. Spent by the sign-in, or expired in ten minutes.
 */
export async function plantSignInLink(email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await devRest("sign_in_codes", {
    method: "POST",
    body: JSON.stringify({
      hub_id: smokeHub(),
      email: email.trim().toLowerCase(),
      // A code nobody knows: this run signs in by the link only.
      code_hash: sha256(randomBytes(16).toString("hex")),
      link_hash: sha256(token),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
  });
  return token;
}


/**
 * One sample process on the smoke hub, as the sample seed would mark it
 * (admin menu slice, 2026-10-13), so the suite can delete a sample the way an
 * admin does. The smoke hub is in beta and has none of its own. An
 * announcement, the plainest kind; the suite deletes it, and afterAll deletes
 * what a failed run left (sample rows are the only process rows anyone may
 * delete).
 */
export async function plantSample(title: string): Promise<string> {
  const id = `proc_sample_smoke_${randomBytes(6).toString("hex")}`;
  await devRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id,
      hub_id: smokeHub(),
      type: "civic.announcement",
      process_version: "0.1",
      title,
      description: "A sample the smoke suite plants and deletes.",
      status: "active",
      state: { status: "active", body: "A sample the smoke suite plants and deletes." },
      created_by: "smoke",
      is_sample: true,
    }),
  });
  return id;
}

/** Delete a sample this run planted, if a failed run left it. */
export async function removeSample(id: string): Promise<void> {
  if (!id.startsWith("proc_sample_smoke_")) throw new Error(`smoke: refusing to delete ${id}`);
  await devRest(`processes?id=eq.${id}&hub_id=eq.${encodeURIComponent(smokeHub())}&is_sample=eq.true`, {
    method: "DELETE",
  }).catch(() => undefined);
}
