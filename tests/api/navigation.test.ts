// The navigation slice (2026-10-14), against a running hub: the registry's
// display for every type in GET /hub-config, the two Theme settings (public,
// validated), and a plugin switched off leaving the stored Section order in
// the same save, so it comes back at the end. New hubs are created with the
// sidebar; existing ones read unset as Top tabs.
//
// Athens's settings are put back as they were (afterAll). Needs the local
// stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession, storedSetting } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const KEYS = ["nav.layout", "nav.section_order", "plugin.conversation.enabled"];

let admin = "";
let resident = "";
let before: Array<[string, string | undefined]> = [];

async function put(section: string, values: Record<string, unknown>) {
  return call("PUT", "/admin/hub/settings", ATHENS, { section, values }, admin);
}

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  resident = await mintSession("athens", `nav-api-${Date.now()}@example.test`);
  before = await Promise.all(KEYS.map(async (k) => [k, await storedSetting("athens", k)] as [string, string | undefined]));
});

// Through the API, which clears its settings cache; a row deleted behind its
// back would be served for a while yet. Empty reads as unset; a plugin's
// switch defaults to on.
afterAll(async () => {
  for (const [k, v] of before) {
    const plugin = k.startsWith("plugin.");
    await put(plugin ? "plugins" : "theme", { [k]: v ?? (plugin ? "true" : "") });
  }
});

describe("GET /hub-config: process_types", () => {
  it("serves every registered type's pill label, icon and section", async () => {
    const res = await call("GET", "/hub-config", ATHENS);
    expect(res.status).toBe(200);
    const types = res.body.process_types as Array<{
      type: string;
      plugin: string;
      label: string;
      icon: string;
      section?: { id: string; label: string; short?: string; path: string; order: number };
    }>;
    const vote = types.find((t) => t.type === "civic.vote")!;
    expect(vote).toMatchObject({ plugin: "vote", label: "Vote", icon: "vote", section: { id: "votes", path: "/votes" } });
    const conversation = types.find((t) => t.type === "civic.polis_deliberation")!;
    expect(conversation.section).toMatchObject({ label: "Conversations", short: "Discuss" });
    expect(types.find((t) => t.type === "civic.brief")!.label).toBe("Outcome");
    // Only what a page draws: no tables, settings or adapters.
    const served = JSON.stringify(types);
    expect(served).not.toMatch(/"tables"|egress|adapter/);
  });
});

describe("Hub settings → Theme: Navigation and Section order", () => {
  it("are an admin's to write, and public once written", async () => {
    expect((await call("PUT", "/admin/hub/settings", ATHENS, { section: "theme", values: { "nav.layout": "sidebar" } }, resident)).status).toBe(403);
    expect((await put("theme", { "nav.layout": "sidebar", "nav.section_order": ["votes", "members"] })).status).toBe(200);
    const settings = (await call("GET", "/hub-config", ATHENS)).body.settings;
    expect(settings["nav.layout"]).toBe("sidebar");
    expect(settings["nav.section_order"]).toBe('["votes","members"]');
  });

  it("refuses a layout that isn't one, Feed in the order, and a section twice", async () => {
    expect((await put("theme", { "nav.layout": "bottom" })).status).toBe(400);
    expect((await put("theme", { "nav.section_order": ["feed", "votes"] })).status).toBe(400);
    expect((await put("theme", { "nav.section_order": ["votes", "votes"] })).status).toBe(400);
  });

  it("a plugin switched off leaves the stored order in the same save; other saves leave it alone", async () => {
    expect((await put("theme", { "nav.section_order": ["votes", "conversations", "proposals"] })).status).toBe(200);
    expect((await put("plugins", { "plugin.conversation.enabled": "true" })).status).toBe(200);
    expect(await storedSetting("athens", "nav.section_order")).toBe('["votes","conversations","proposals"]');

    expect((await put("plugins", { "plugin.conversation.enabled": "false" })).status).toBe(200);
    expect(await storedSetting("athens", "nav.section_order")).toBe('["votes","proposals"]');
    // Switched on again, it is not in the order: it is drawn at the end.
    expect((await put("plugins", { "plugin.conversation.enabled": "true" })).status).toBe(200);
    expect(await storedSetting("athens", "nav.section_order")).toBe('["votes","proposals"]');
  });
});
