// Feedback goes to the hub's own people: its configured recipient, else its
// admin roster — never a hardcoded personal address (Phase 2a).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { feedbackRecipients } from "../../src/modules/civic.feedback/service.js";

describe("feedbackRecipients", () => {
  it("uses the configured recipient when there is one", () => {
    expect(feedbackRecipients(["feedback@hub.example"], ["admin@hub.example"])).toEqual([
      "feedback@hub.example",
    ]);
  });

  it("falls back to every admin on the hub's roster", () => {
    expect(
      feedbackRecipients([], ["a@hub.example", "b@hub.example", "a@hub.example"]),
    ).toEqual(["a@hub.example", "b@hub.example"]);
  });

  it("mails nobody when the hub has neither", () => {
    expect(feedbackRecipients([], [])).toEqual([]);
  });

  it("names no personal address in the module", () => {
    const src = readFileSync(
      join(__dirname, "../../src/modules/civic.feedback/service.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/[a-z0-9._%+-]+@civic\.social/i);
  });
});
