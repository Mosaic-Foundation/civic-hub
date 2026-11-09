// An admin archives something still running: its creator is told (Adam,
// 2026-11-09), for any type, named from its manifest, with the reason. Not
// for something already closed, nor when the admin archived their own.
// In-process on Athens with a configured fake transport, as notify.test.ts
// does. The creator is Athens' admin address, which the demo hub's mail guard
// lets through; the archiving admin is another account.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const run = Date.now().toString(36);
const ids = { open: `proc_arch_open_${run}`, closed: `proc_arch_closed_${run}`, own: `proc_arch_own_${run}` };

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

async function userId(email: string): Promise<string> {
  await mintSession("athens", email);
  const [row] = (await localRest(`users?select=id&hub_id=eq.athens&email=eq.${encodeURIComponent(email)}`)) as Array<{ id: string }>;
  return row.id;
}

let creator = "";
let archiver = "";

async function insert(id: string, status: string, by: string) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id, hub_id: "athens", type: "civic.event", title: `Archive notice ${id}`, description: "d", status, created_by: by,
      state: { start_time: new Date(Date.now() + 86_400_000).toISOString(), end_time: new Date(Date.now() + 90_000_000).toISOString() },
    }),
  });
}

beforeAll(async () => {
  creator = await userId("admin+athens@example.test");
  archiver = await userId(`archiver-${run}@example.test`);
  await insert(ids.open, "active", creator);
  await insert(ids.closed, "closed", creator);
  await insert(ids.own, "active", archiver);
});

afterAll(async () => {
  for (const id of Object.values(ids)) await localRest(`processes?id=eq.${id}`, { method: "DELETE" });
  const { installAdapters } = await import("../../src/adapters/index.js");
  const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
  installAdapters({ mail: fakeMail() });
});

describe("archiving tells the creator", () => {
  it("of something still running: the type's own word, the title and the reason", async () => {
    const { installAdapters } = await import("../../src/adapters/index.js");
    const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
    const mail = fakeMail({ configured: true });
    installAdapters({ mail });
    const { archiveProcess } = await import("../../src/services/processService.js");
    const inHub = await inProcess();

    await inHub(() => archiveProcess(ids.open, archiver, "Duplicate of another event"));
    expect(mail.outbox.map((m) => m.to)).toEqual(["admin+athens@example.test"]);
    const [m] = mail.outbox;
    expect(m.subject).toContain(`Your event "Archive notice ${ids.open}" was archived`);
    expect(m.text).toContain("Duplicate of another event");
    expect(m.text).not.toMatch(/process/i);
  });

  it("not of something already closed, nor of the admin's own", async () => {
    const { installAdapters } = await import("../../src/adapters/index.js");
    const { fakeMail } = await import("../../src/adapters/fakes/mail.js");
    const mail = fakeMail({ configured: true });
    installAdapters({ mail });
    const { archiveProcess } = await import("../../src/services/processService.js");
    const inHub = await inProcess();

    await inHub(() => archiveProcess(ids.closed, archiver, "Old"));
    await inHub(() => archiveProcess(ids.own, archiver, "Mine"));
    expect(mail.outbox).toEqual([]);
  });
});
