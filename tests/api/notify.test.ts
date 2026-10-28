// notify() (Events 2, E2): a package names accounts, the hub holds the
// addresses. In-process on Athens (demo), in the server's mode, with a
// configured fake transport whose outbox is what reached "the provider"
// (ADR-012), as heldBackAndQueues.test.ts does.
//
//   - one message per person, the hub's name in the subject, the process's
//     own page as the link, and how to unsubscribe;
//   - an unsubscribed person, an unverified address and another hub's account
//     are skipped; the demo hub's guard holds back a resident (not a failure);
//   - a type whose grant does not name `mail` is refused, as a reach past it.
//
// The grant is a test's own (registerGrant), on one of Athens' processes, and
// put back after.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const run = Date.now();

async function inProcess() {
  const { url, key } = localStack();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  if (process.env.CIVIC_EXPECT_HUB_DB_MODE?.trim() === "hub_token") {
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    process.env.CIVIC_HUB_SIGNING_KEY ??= LOCAL_JWT_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY ??= LOCAL_PUBLISHABLE_KEY;
  } else {
    process.env.CIVIC_HUB_MINTED_TOKEN = "false";
  }
  const { getHubBySlug } = await import("../../src/db/hubs.js");
  const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
  const { runWithHub } = await import("../../src/config/hubContext.js");
  const hub = (await getHubBySlug("athens"))!;
  const settings = await fetchHubSettings("athens");
  return <T>(fn: () => Promise<T>) => runWithHub(hub, settings, fn);
}

async function accountOf(hub: string, email: string, patch: Record<string, unknown> = {}): Promise<string> {
  await mintSession(hub, email);
  const [row] = (await localRest(`users?select=id&hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`)) as Array<{ id: string }>;
  await localRest(`users?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ digest_frequency_days: 7, ...patch }) });
  return row.id;
}

let ids: Record<"admin" | "resident" | "unsubscribed" | "unverified" | "elsewhere", string>;
let target: { id: string; type: string };
let restoreGrant: () => void = () => {};

/** The type's package granted `adapters` (and nothing a hub approved otherwise). */
async function grantTo(adapters: string[]) {
  const { grantOfType, registerGrant } = await import("../../src/plugins/grant.js");
  const was = grantOfType(target.type)!;
  registerGrant(target.type, "@civic-social/test-notify", { ...was.caps, adapters: adapters as never });
  restoreGrant = () => registerGrant(target.type, was.packageName, was.caps);
}

beforeAll(async () => {
  [target] = (await localRest("processes?select=id,type&hub_id=eq.athens&type=eq.civic.vote&limit=1")) as Array<{ id: string; type: string }>;
  ids = {
    // Athens' admin: a demo hub still writes to its admins.
    admin: await accountOf("athens", "admin+athens@example.test"),
    resident: await accountOf("athens", `notify-resident-${run}@example.test`),
    unsubscribed: await accountOf("athens", `notify-unsub-${run}@example.test`, { digest_frequency_days: null }),
    unverified: await accountOf("athens", `notify-unverified-${run}@example.test`, { email_verified: false }),
    elsewhere: await accountOf("floyd", `notify-floyd-${run}@example.test`),
  };
});

afterAll(async () => {
  restoreGrant();
  const { installAdapters } = await import("../../src/adapters/index.js");
  const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
  installAdapters({ mail: fakeMail() });
});

describe("notify(): the hub tells the accounts a package names", () => {
  it("one message each to whom it may write; skips the unsubscribed, the unverified and other hubs' accounts", async () => {
    const { installAdapters } = await import("../../src/adapters/index.js");
    const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
    const mail = fakeMail({ configured: true });
    installAdapters({ mail });
    const { notify } = await import("../../src/sdk/index.js");
    const inHub = await inProcess();
    await grantTo(["mail"]);

    const report = await inHub(() => notify(target.id, Object.values(ids), { subject: "The room has changed", text: "We meet upstairs now." }));

    expect(report).toEqual({ sent: 1, held_back: 1, skipped: 3, failed: 0 });
    expect(mail.outbox.map((m) => m.to)).toEqual(["admin+athens@example.test"]);
    const [m] = mail.outbox;
    expect(m.subject).toMatch(/: The room has changed$/);
    expect(m.text).toContain("We meet upstairs now.");
    expect(m.text).toContain(`/${target.id}`);
    expect(m.text).toMatch(/unsubscribe in your settings: https?:\/\/[^\s]+\/settings/);
  });

  it("refuses a type whose grant does not name mail", async () => {
    const { notify } = await import("../../src/sdk/index.js");
    const inHub = await inProcess();
    await grantTo([]);
    await expect(inHub(() => notify(target.id, [ids.admin], { subject: "x", text: "y" }))).rejects.toMatchObject({ code: "plugin_grant_refused" });
  });
});
