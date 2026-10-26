/**
 * The capability grant at the hub's seams (ADR-014): a package that reaches
 * past its grant is refused and reported, one test per kind of reach: a
 * table, an adapter, an event. Refused in production too: a grant is a
 * boundary, not a description.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/forHub.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/forHub.js")>()),
  // An allowed table reaches forHub(); nothing here needs a database.
  forHub: () => ({ from: (table: string) => ({ table }) }),
}));

import { createHost } from "../../src/plugins/host.js";
import { GrantRefusedError, checkEmissionGrant, registerGrant } from "../../src/plugins/grant.js";
import { buildEvent } from "../../src/events/eventEmitter.js";
import { withHubScope } from "../../src/config/hubContext.js";
import type { Hub } from "../../src/models/hub.js";
import type { PluginCapabilities } from "../../src/shared/pluginGrant.js";
import { HOST_EVENT_TYPES } from "../../src/processes/descriptor.js";

const CAPS: PluginCapabilities = {
  activities: { emit: ["civic.process.started"], listen: [] },
  state: { read: ["own-process"], write: ["own-process"], tables: ["wordcloud_submissions"] },
  adapters: ["mail"],
  network: { egress: [] },
  identity: { claims: ["participant-ref"] },
  ui: { surfaces: ["process-page"] },
};

const HUB = { id: "grant-hub", hostname: "grant.localhost", name: "Grant hub", status: "active" } as unknown as Hub;

let reported: string[] = [];
beforeEach(() => {
  reported = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    reported.push(String(line));
  });
});

function refusal(fn: () => unknown): GrantRefusedError {
  try {
    fn();
  } catch (err) {
    if (err instanceof GrantRefusedError) return err;
    throw err;
  }
  throw new Error("expected a GrantRefusedError");
}

describe("the capability grant at the seams", () => {
  it("a table: the package's database refuses a table its grant does not list, and reports it", () => {
    const host = createHost("@test/reacher", CAPS);
    return withHubScope(HUB, {}, async () => {
      expect(host.db().from("wordcloud_submissions")).toEqual({ table: "wordcloud_submissions" });
      const err = refusal(() => host.db().from("users"));
      expect(err.reach).toBe("table");
      expect(err.what).toBe("users");
      expect(err.status).toBe(500);
      expect(err.code).toBe("plugin_grant_refused");
      expect(reported.some((l) => l.includes("[civic-error:plugin.grant.table]") && l.includes("@test/reacher"))).toBe(true);
    });
  });

  it("an adapter: the host hands out only the adapters the grant lists, and reports the rest", () => {
    const host = createHost("@test/reacher", CAPS);
    expect(typeof host.adapter("mail").send).toBe("function");
    for (const name of ["ai", "video", "deliberation", "objectStore"] as const) {
      const err = refusal(() => host.adapter(name));
      expect(err.reach).toBe("adapter");
      expect(err.what).toBe(name);
    }
    expect(reported.filter((l) => l.includes("[civic-error:plugin.grant.adapter]"))).toHaveLength(4);
  });

  it("an event: the emission path refuses an event type outside the grant, before anything is stored", () => {
    registerGrant("civic.reacher", "@test/reacher", CAPS);
    expect(() => checkEmissionGrant("civic.reacher", "civic.process.started", HOST_EVENT_TYPES)).not.toThrow();
    // The hub's own lifecycle events are the hub's, for every type.
    expect(() => checkEmissionGrant("civic.reacher", "civic.process.created", HOST_EVENT_TYPES)).not.toThrow();
    const err = refusal(() => checkEmissionGrant("civic.reacher", "civic.process.vote_submitted", HOST_EVENT_TYPES));
    expect(err.reach).toBe("event");
    expect(reported.some((l) => l.includes("[civic-error:plugin.grant.event]"))).toBe(true);
  });

  it("an event, through buildEvent: a word cloud may not emit a vote's ballot", () => {
    return withHubScope(HUB, {}, async () => {
      const err = refusal(() =>
        buildEvent({
          event_type: "civic.process.vote_submitted",
          actor: "user_1",
          process_id: "proc_1",
          processType: "civic.wordcloud",
          jurisdiction: "us-xx-test",
          data: {},
        } as never),
      );
      expect(err.packageName).toBe("@civic-social/plugin-wordcloud");
      expect(err.what).toBe("civic.process.vote_submitted");
    });
  });
});
