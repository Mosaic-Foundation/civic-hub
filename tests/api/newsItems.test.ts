// News Sync's own type (Adam, 2026-11-18; packages/civic.news_sync): a News
// item reads at GET /news/:id and makes a News card on the feed, with
// Announcements switched off; it is not an announcement (GET
// /announcement/:id is 404); an item relabelled from an announcement (the
// migration's shape: `content`, `author_role`, `source`) reads the same, and
// its stored announcement event still makes a News card while Announcements
// is off.
//
// The job itself reaches an outside feed, so the items are inserted as the job
// would leave them, on Athens, with News Sync switched on for the run. Needs the local stack seeded as in CI and a server
// (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const run = Date.now().toString(36);
const fresh = `proc_news_${run}`;
const relabelled = `proc_news_old_${run}`;
const at = new Date().toISOString();

let admin = "";

async function insertItem(id: string, state: Record<string, unknown>, event: Record<string, unknown>) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id, hub_id: "athens", type: "civic.news", title: `News item ${id}`, description: "", status: "finalized",
      jurisdiction: "local", content: {}, state, created_by: "system:news-sync-cron",
    }),
  });
  await localRest("events", {
    method: "POST",
    body: JSON.stringify({
      id: `evt_${id}`, hub_id: "athens", event_type: "civic.process.result_published",
      process_id: id, actor: "system:news-sync-cron", jurisdiction: "local",
      action_url: "https://news.example.test/post/1",
      data: event, meta: { visibility: "public" },
    }),
  });
}

async function setPlugins(values: Record<string, string>) {
  const res = await call("PUT", "/admin/hub/settings", ATHENS, { section: "plugins", values }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** Athens's News Sync switch before the run (its seed has it off: it has no feed). */
let newsSyncBefore = "false";

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  newsSyncBefore = (await call("GET", "/hub-config", ATHENS)).body.settings["plugin.news_sync.enabled"] ?? "true";
  await setPlugins({ "plugin.news_sync.enabled": "true" });
  await insertItem(
    fresh,
    {
      type: "civic.news",
      content: { title: `Road work ${run}`, body: "The road is closed on Tuesday." },
      source: { origin: "news-sync", connector: "wix-cms", share_url: "https://news.example.test/post/1", ingested_at: at, label: "Athens Public Works", pill: "County news" },
      created_at: at,
    },
    {
      process: { type: "civic.news" },
      news: { title: `Road work ${run}`, body_preview: "The road is closed", source: { share_url: "https://news.example.test/post/1", label: "Athens Public Works", pill: "County news" } },
    },
  );
  await insertItem(
    relabelled,
    {
      type: "civic.announcement",
      content: { title: `Old post ${run}`, body: "Copied in before the split.", links: [], image_url: null, image_alt: null },
      author_id: "system:news-sync-cron", author_role: "Town of Athens Government", created_at: at, edit_count: 0, last_edited_at: null,
      source: { origin: "news-sync", share_url: "https://news.example.test/post/0", ingested_at: at },
    },
    {
      process: { type: "civic.announcement" },
      announcement: { title: `Old post ${run}`, body_preview: "Copied in", author_role: "Town of Athens Government", source: { origin: "news-sync", share_url: "https://news.example.test/post/0" } },
    },
  );
});

afterAll(async () => {
  await setPlugins({ "plugin.announcement.enabled": "true", "plugin.news_sync.enabled": newsSyncBefore });
  // Events can't be deleted; their processes are archived, which hides them.
  for (const id of [fresh, relabelled]) {
    await localRest(`processes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
  }
});

describe("a News item", () => {
  it("reads at /news/:id with its source", async () => {
    const res = await call("GET", `/news/${fresh}`, ATHENS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: fresh,
      type: "civic.news",
      title: `Road work ${run}`,
      body: "The road is closed on Tuesday.",
      from: "Athens Public Works",
      pill: "County news",
      share_url: "https://news.example.test/post/1",
    });
  });

  it("is not an announcement", async () => {
    expect((await call("GET", `/announcement/${fresh}`, ATHENS)).status).toBe(404);
  });

  it("an item relabelled from an announcement reads the same, from its old author label", async () => {
    const res = await call("GET", `/news/${relabelled}`, ATHENS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ title: `Old post ${run}`, from: "Town of Athens Government", pill: "News" });
  });

  it("both make News cards with Announcements switched off", async () => {
    await setPlugins({ "plugin.announcement.enabled": "false" });
    const res = await call("GET", "/api/feed?surface=news&limit=50", ATHENS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.events as Array<{ process_id: string }>).map((e) => e.process_id);
    expect(ids).toContain(fresh);
    expect(ids).toContain(relabelled);
  });

  it("pinned, the Pinned card names it with its type's word, as any pinned item", async () => {
    expect((await call("POST", `/pins/${fresh}`, ATHENS, {}, admin)).status).toBe(200);
    try {
      const res = await call("GET", "/pins", ATHENS);
      expect((res.body.items as Array<{ process_id: string; type_label: string }>).find((a) => a.process_id === fresh)?.type_label).toBe("News");
    } finally {
      await call("DELETE", `/pins/${fresh}`, ATHENS, undefined, admin);
    }
  });
});
