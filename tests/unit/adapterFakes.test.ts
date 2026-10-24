// The in-memory adapters (src/adapters/fakes/, ADR-012): what the unit and
// API suites, Playwright and the run-anywhere job use. Each does what its
// header says, so a suite relying on it is relying on something pinned.

import { describe, expect, it } from "vitest";
import { adapterNames, adapters, installAdapters, noneAdapters } from "../../src/adapters/index.js";
import { fakeAi, FAKE_AI_DOWN, FAKE_AI_REPLY } from "../../src/adapters/fakes/ai.js";
import { fakeMail } from "../../src/adapters/fakes/mail.js";
import { fakeVideo } from "../../src/adapters/fakes/video.js";
import { fakeErrors } from "../../src/adapters/fakes/errors.js";
import { fakeHeartbeat } from "../../src/adapters/fakes/heartbeat.js";
import { memoryObjectStore } from "../../src/adapters/fakes/objectStore.js";

describe("the fakes", () => {
  it("ai: answers a reply tool with a message and no suggestions, keeps every call, fails on [ai-down]", async () => {
    const ai = fakeAi();
    const out = await ai.converse({ model: "m", messages: [{ role: "user", content: "hi" }], responseTool: "respond" }, { purpose: "assistant.message" });
    expect(out.structured).toEqual({ message: FAKE_AI_REPLY, suggestions: [] });
    expect((await ai.complete({ model: "m", userText: "x" }, { purpose: "job.news_sync" })).text).toBe("Test summary.");
    await expect(ai.complete({ model: "m", userText: FAKE_AI_DOWN }, { purpose: "job.news_sync" })).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(ai.calls.map((c) => c.purpose)).toEqual(["assistant.message", "job.news_sync", "job.news_sync"]);
  });

  it("mail: not configured by default (a keyless deployment's behaviour); configured, it keeps an outbox", async () => {
    expect(fakeMail().configured()).toBe(false);
    const mail = fakeMail({ configured: true });
    expect(await mail.send({ from: "a@b.c", to: "x@y.z", subject: "s", html: "<p>h</p>", text: "h" })).toEqual({ sent: true, id: "fake-1" });
    expect(mail.outbox.map((m) => m.to)).toEqual(["x@y.z"]);
  });

  it("video: a fixed transcript, none for a no-transcript URL", async () => {
    const video = fakeVideo();
    expect((await video.transcript("https://www.youtube.com/watch?v=aaaaaaaaaaa")).length).toBeGreaterThan(0);
    await expect(video.transcript("https://example.test/no-transcript")).rejects.toThrow();
  });

  it("errors and heartbeat: kept in memory", async () => {
    const errors = fakeErrors();
    await errors.send({ event_id: "e1" });
    expect(errors.sent).toEqual([{ event_id: "e1" }]);
    const hb = fakeHeartbeat();
    await hb.ping("vote_close", false);
    expect(hb.pings).toEqual([{ jobId: "vote_close", ok: false }]);
  });

  it("objectStore: refuses a key outside the hub's prefix, never overwrites, lists and removes", async () => {
    const store = memoryObjectStore();
    await expect(store.putPublic("athens", "post-images", "floyd/x.png", Buffer.from("x"), { contentType: "image/png", cacheControl: "x" })).rejects.toThrow();
    const url = await store.putPublic("athens", "post-images", "athens/x.png", Buffer.from("x"), { contentType: "image/png", cacheControl: "x" });
    expect(url).toMatch(/\/post-images\/athens\/x\.png$/);
    await expect(store.putPublic("athens", "post-images", "athens/x.png", Buffer.from("y"), { contentType: "image/png", cacheControl: "x" })).rejects.toThrow();
    await store.put("hub-exports", "athens/e.tar.gz", Buffer.from("z"), { contentType: "application/gzip" });
    expect((await store.listAll("hub-exports"))?.map((o) => o.key)).toEqual(["athens/e.tar.gz"]);
    await store.remove("hub-exports", ["athens/e.tar.gz"]);
    expect(await store.listAll("hub-exports")).toEqual([]);
  });
});

describe("the registry", () => {
  it("starts with every adapter 'none' (not configured), and installs over it by name", () => {
    const none = noneAdapters();
    expect(none.ai.configured()).toBe(false);
    expect(none.mail.configured()).toBe(false);
    expect(none.errors.enabled()).toBe(false);
    const ai = fakeAi();
    installAdapters({ ai });
    expect(adapters().ai).toBe(ai);
    expect(adapterNames().ai).toBe("fake");
  });
});
