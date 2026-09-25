// Phase 2c: every URL a hub publishes names that hub's own host.
//
// Before this, baseUrl() and uiBaseUrl() read one env var for the whole
// deployment, so Athens's events, emails and collection ids carried Floyd's
// hostname (seen on the dev wire in 2a). Now the hub in scope's
// hubs.hostname is the origin: https in production, the dev scheme for a
// local hostname outside it; BASE_URL / CIVIC_UI_BASE_URL are the fallback
// only when no hub is in scope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appended: Array<{ source: { hub_url: string }; action_url: string }> = [];
vi.mock("../../src/events/eventStore.js", () => ({
  appendEvent: vi.fn(async (e: { source: { hub_url: string }; action_url: string }) => {
    appended.push(e);
  }),
}));

import { emitEvent } from "../../src/events/eventEmitter.js";
import { baseUrl, hubOrigin, uiBaseUrl } from "../../src/utils/baseUrl.js";
import { runWithHub } from "../../src/config/hubContext.js";
import { ATHENS_HUB, FLOYD_HUB } from "../fixtures/hubs/index.js";
import type { Hub } from "../../src/models/hub.js";

const saved = { ...process.env };
beforeEach(() => {
  appended.length = 0;
  process.env.BASE_URL = "https://deployment.example";
  delete process.env.CIVIC_UI_BASE_URL;
  process.env.NODE_ENV = "production";
});
afterEach(() => {
  process.env = { ...saved };
});

const LOCAL_ATHENS: Hub = { ...ATHENS_HUB, hostname: "athens.localhost" };

function emitCreated() {
  return emitEvent({
    event_type: "civic.process.created",
    actor: "user_1",
    process_id: "proc_1",
    jurisdiction: "local",
    data: { process: { type: "civic.vote", title: "t" } },
  });
}

describe("per-hub base URL", () => {
  it("an Athens event carries Athens's hostname, a Floyd event Floyd's", async () => {
    const athens = await runWithHub(ATHENS_HUB, {}, emitCreated);
    const floyd = await runWithHub(FLOYD_HUB, {}, emitCreated);

    expect(athens.source.hub_url).toBe(`https://${ATHENS_HUB.hostname}`);
    expect(athens.action_url).toBe(`https://${ATHENS_HUB.hostname}/process/proc_1`);
    expect(floyd.source.hub_url).toBe(`https://${FLOYD_HUB.hostname}`);
    expect(JSON.stringify(athens)).not.toContain(FLOYD_HUB.hostname);
    expect(JSON.stringify(athens)).not.toContain("deployment.example");
  });

  it("links built in a hub's scope (email, admin, share) use that hub", () => {
    runWithHub(ATHENS_HUB, {}, () => {
      expect(uiBaseUrl()).toBe(`https://${ATHENS_HUB.hostname}`);
      expect(baseUrl()).toBe(`https://${ATHENS_HUB.hostname}`);
    });
  });

  it("falls back to BASE_URL / CIVIC_UI_BASE_URL only with no hub in scope", () => {
    process.env.CIVIC_UI_BASE_URL = "https://ui.deployment.example/";
    expect(baseUrl()).toBe("https://deployment.example");
    expect(uiBaseUrl()).toBe("https://ui.deployment.example");
  });

  it("a local hostname gets the dev scheme and port outside production only", () => {
    process.env.NODE_ENV = "development";
    process.env.BASE_URL = "http://localhost:3400";
    process.env.CIVIC_UI_BASE_URL = "http://localhost:5173";
    runWithHub(LOCAL_ATHENS, {}, () => {
      expect(baseUrl()).toBe("http://athens.localhost:3400");
      expect(uiBaseUrl()).toBe("http://athens.localhost:5173");
    });
    // A real hostname is https even in development.
    runWithHub(FLOYD_HUB, {}, () => expect(uiBaseUrl()).toBe(`https://${FLOYD_HUB.hostname}`));
    // And in production a local hostname is never downgraded to http.
    process.env.NODE_ENV = "production";
    expect(hubOrigin("athens.localhost", "http://localhost:3400")).toBe("https://athens.localhost");
  });

  it("does not borrow a port from a non-local env origin", () => {
    process.env.NODE_ENV = "development";
    expect(hubOrigin("athens.localhost", "https://deployment.example:8443")).toBe("http://athens.localhost");
  });
});
