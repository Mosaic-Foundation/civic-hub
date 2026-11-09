// The review emails name the type from its manifest (Adam, 2026-11-09: an
// event's "now live" email said "Your Process"). Every registered type is
// named by its own label, lower case in a sentence, and one with no manifest
// by its id's last word, never "process".

import { describe, expect, it } from "vitest";
import { processTypeLabel } from "../../src/modules/civic.review/email.js";
import { getManifests } from "../../src/processes/registry.js";

describe("the review emails' type word", () => {
  it("is each registered type's own label", () => {
    expect(processTypeLabel("civic.event")).toBe("event");
    expect(processTypeLabel("civic.vote")).toBe("vote");
    expect(processTypeLabel("civic.polis_deliberation")).toBe("conversation");
    for (const m of getManifests()) {
      expect(processTypeLabel(m.descriptor.type), m.descriptor.type).toBe(m.descriptor.display.label.toLowerCase());
    }
  });

  it("names a type without a manifest by its id, never \"process\"", () => {
    expect(processTypeLabel("civic.budget_round")).toBe("budget round");
    expect(processTypeLabel("")).toBe("submission");
  });
});
