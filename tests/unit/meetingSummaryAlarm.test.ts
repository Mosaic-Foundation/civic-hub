// Regression tests for the meeting-summary cron's failure visibility.
//
// THE BUG THESE EXIST FOR
// Floyd County moved its agendas-and-minutes page to client-side rendering.
// `fetch()` does not run JavaScript, so discovery began returning a shell
// with no meeting links in it — zero entries. The cron treated that as an
// ordinary empty run: HTTP 200, failed=0, and the notifier bailed out early
// because it only fired when `failed > 0`. Meeting summaries stopped being
// generated and nothing anywhere said so.
//
// The rule these tests pin down: a run that discovers nothing, or that dies
// outright, is a FAILURE and must reach a human. Only a run that discovered
// meetings and processed them without error is allowed to stay quiet.

import { describe, it, expect } from "vitest";
import { cronAlertReason } from "../../src/controllers/meetingSummaryController.js";

const healthy = {
  discovered: 8,
  created: 3,
  skippedExisting: 5,
  failed: 0,
  failures: [] as Array<{ source_id: string; error: string }>,
  duration_ms: 4200,
  connector_id: "youtube-channel",
};

describe("cronAlertReason — when the cron must speak up", () => {
  it("stays quiet when meetings were found and nothing failed", () => {
    expect(cronAlertReason(healthy)).toBeNull();
  });

  it("stays quiet when every discovered meeting was already summarized", () => {
    // The steady state of a daily cron against a body that meets twice a
    // month: everything discovered, nothing new. Not a problem.
    expect(
      cronAlertReason({ ...healthy, created: 0, skippedExisting: 8 }),
    ).toBeNull();
  });

  it("ALERTS when discovery returns zero meetings", () => {
    // The exact shape of the Floyd outage. Previously indistinguishable
    // from success.
    const reason = cronAlertReason({
      ...healthy,
      discovered: 0,
      created: 0,
      skippedExisting: 0,
    });
    expect(reason).not.toBeNull();
    expect(reason).toContain("0 meetings");
    expect(reason).toContain("youtube-channel");
  });

  it("names the connector in the empty-discovery alert so the operator knows where to look", () => {
    const reason = cronAlertReason({
      ...healthy,
      discovered: 0,
      connector_id: "floyd-minutes-page",
    });
    expect(reason).toContain("floyd-minutes-page");
  });

  it("ALERTS when individual meetings failed to summarize", () => {
    const reason = cronAlertReason({
      ...healthy,
      failed: 2,
      failures: [
        { source_id: "youtube:UC…:2026-08-11:bos", error: "Supadata 429" },
        { source_id: "youtube:UC…:2026-07-28:bos", error: "PDF too large" },
      ],
    });
    expect(reason).toContain("2 meeting(s) failed");
  });

  it("ALERTS when the run aborted before finishing", () => {
    // Previously this returned 500 to a cron caller that reads nobody's
    // response — the loudest possible failure, delivered to no one.
    const reason = cronAlertReason({
      ...healthy,
      discovered: 0,
      fatal: "ANTHROPIC_API_KEY must be set.",
    });
    expect(reason).toContain("aborted");
    expect(reason).toContain("ANTHROPIC_API_KEY");
  });

  it("reports the abort reason ahead of the empty-discovery reason", () => {
    // A run that died during discovery also has discovered=0; the cause is
    // more useful to the reader than the symptom.
    const reason = cronAlertReason({
      ...healthy,
      discovered: 0,
      failed: 3,
      fatal: "fetch failed: ENOTFOUND",
    });
    expect(reason).toContain("ENOTFOUND");
  });

  it("treats a partially successful run with failures as alert-worthy", () => {
    expect(
      cronAlertReason({
        ...healthy,
        created: 2,
        failed: 1,
        failures: [{ source_id: "x", error: "boom" }],
      }),
    ).not.toBeNull();
  });
});
