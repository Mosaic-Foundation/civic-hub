// source.hub_id is the publishing hub's protocol identity (hubs.protocol_hub_id),
// never its tenant id and never the deployment-wide HUB_ID while a hub is in
// scope. Decided with Adam, 2026-09-24, when processes.hub_id became the
// tenant column.

import { describe, it, expect, vi, beforeEach } from "vitest";

const appended: Array<{ source: { hub_id: string } }> = [];
vi.mock("../../src/events/eventStore.js", () => ({
  appendEvent: vi.fn(async (e: { source: { hub_id: string } }) => {
    appended.push(e);
  }),
}));

import { emitEvent } from "../../src/events/eventEmitter.js";
import { protocolHubId, HUB_ID } from "../../src/config/hub.js";
import { runWithHub } from "../../src/config/hubContext.js";
import { FLOYD_HUB, ATHENS_HUB } from "../fixtures/hubs/index.js";

function created(hub_id?: string) {
  return emitEvent({
    event_type: "civic.process.created",
    actor: "user_1",
    process_id: "proc_1",
    // What callers pass today: the process's TENANT id. Must be ignored.
    hub_id,
    jurisdiction: "local",
    data: { process: { type: "civic.vote", title: "t" } },
  });
}

describe("protocol identity per hub", () => {
  beforeEach(() => {
    appended.length = 0;
  });

  it("Floyd keeps the identity its published events already carry", () => {
    expect(runWithHub(FLOYD_HUB, {}, () => protocolHubId())).toBe("civic-hub-local");
  });

  it("each hub publishes under its own protocol id, not its tenant id", async () => {
    const floyd = await runWithHub(FLOYD_HUB, {}, () => created("floyd"));
    const athens = await runWithHub(ATHENS_HUB, {}, () => created("athens"));
    expect(floyd.source.hub_id).toBe("civic-hub-local");
    expect(athens.source.hub_id).toBe("civic-hub-athens");
    expect(appended.map((e) => e.source.hub_id)).toEqual([
      "civic-hub-local",
      "civic-hub-athens",
    ]);
  });

  it("falls back to HUB_ID only with no hub in scope", async () => {
    expect(protocolHubId()).toBe(HUB_ID);
    const e = await created();
    expect(e.source.hub_id).toBe(HUB_ID);
  });
});
