// Activity's line in the admin digest (ADR-016): last month's numbers on the
// first digest of a month, in the hub's calendar, and nothing otherwise; a
// digest with a note is sent even when the queues have nothing new.

import { describe, expect, it } from "vitest";
import { digestLine } from "../../features/analytics/digest.js";
import { renderAdminDigestEmail } from "../../src/modules/civic.admin_digest/index.js";
import type { FeatureHost } from "../../src/plugins/feature.js";

const untouchable: FeatureHost = {
  featureId: "analytics",
  db: () => {
    throw new Error("the line read the database on a day it says nothing");
  },
  eventLog: () => {
    throw new Error("the line read the event log on a day it says nothing");
  },
  launchedAt: () => {
    throw new Error("the line read the hub's launch on a day it says nothing");
  },
};

describe("the digest's Activity line", () => {
  it("says nothing on any day but the first of the month, without reading anything", async () => {
    const line = digestLine(untouchable);
    expect(await line({ now: new Date("2026-10-27T13:30:00Z") })).toBeNull();
    expect(await line({ now: new Date("2026-11-02T13:30:00Z") })).toBeNull();
  });

  it("an email with only a note is sent, with the note in both bodies", () => {
    const note = "Activity in October 2026: 6 active residents, 2 new, 46 participations, 5 processes created and 2 closed.";
    const mail = renderAdminDigestEmail({
      hub_name: "Example Civic Hub",
      since: "2026-10-31T13:30:00.000Z",
      until: "2026-11-01T13:30:00.000Z",
      lines: [],
      new_total: 0,
      notes: [note],
      empty: false,
    });
    expect(mail.subject).toBe("[Example Civic Hub] Last month's activity");
    expect(mail.text).toContain(note);
    expect(mail.html).toContain("6 active residents");
  });
});
