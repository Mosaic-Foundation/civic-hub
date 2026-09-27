/**
 * The no-hub page on Vercel.
 *
 * Vercel serves the SPA shell as a static file, without the server, so a
 * hostname with no hub used to get the app with "Could not load the feed:
 * no_hub" instead of the server's "No hub here". The shell now reads the
 * answer from /hub-config and renders the same dead end (ui/src/main.tsx).
 * These pin which answers count as definitive: a transient failure must
 * still render the app on fallbacks, never a dead end.
 */

import { describe, it, expect } from "vitest";
import { deadEndFromResponse } from "../../ui/src/config/hubConfig.js";
import { DEAD_ENDS } from "../../src/shared/deadEnd.js";

describe("deadEndFromResponse", () => {
  it("treats 404 no_hub as the no-hub page", () => {
    expect(deadEndFromResponse(404, { error: "no_hub" })).toBe("no_hub");
  });

  it("treats 503 hub_suspended as the paused page", () => {
    expect(deadEndFromResponse(503, { error: "hub_suspended" })).toBe("hub_suspended");
  });

  it("renders the app for anything transient or unexpected", () => {
    expect(deadEndFromResponse(500, { error: "no_hub" })).toBeNull();
    expect(deadEndFromResponse(404, { error: "not_found" })).toBeNull();
    expect(deadEndFromResponse(404, null)).toBeNull();
    expect(deadEndFromResponse(502, "<html>Bad gateway</html>")).toBeNull();
    expect(deadEndFromResponse(503, { error: "no_hub" })).toBeNull();
  });

  it("uses the wording the runbooks check for", () => {
    // RUNBOOK-cutover.md §8 step 6 and RUNBOOK-release-1.md look for this title.
    expect(DEAD_ENDS.no_hub.title).toBe("No hub here");
  });
});
