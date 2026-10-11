// The Code of Conduct check is tied to the text it read (audit A4,
// 2026-10-11). The hash is what a submit compares, so it must change with
// every checked field and with nothing else.

import { describe, it, expect } from "vitest";
import {
  codeOfConductFields,
  codeOfConductHash,
  toDraftState,
} from "../../src/services/codeOfConduct.js";
import type { AssistantDraft } from "../../src/modules/civic.assistant/index.js";

function draft(over: Partial<AssistantDraft> = {}): AssistantDraft {
  return {
    id: "vdraft_1",
    user_id: "user_1",
    status: "drafting",
    title: "Fix the crossing",
    description: "A crosswalk by the school.",
    sources: "https://example.test/report",
    conversation_history: [],
    ...over,
  };
}
const hashOf = (d: AssistantDraft) => codeOfConductHash(codeOfConductFields(toDraftState(d)));

describe("the checked fields' hash", () => {
  it("is the same for the same text", () => {
    expect(hashOf(draft())).toBe(hashOf(draft()));
  });

  it("changes when any checked field changes", () => {
    const base = hashOf(draft());
    for (const over of [
      { title: "Fix the crossing!" },
      { description: "Something else." },
      { sources: "" },
      { considerations: "Cost." },
      { seed_statements: "We need it." },
      { options: "Yes\nNo" },
    ] as Partial<AssistantDraft>[]) {
      expect(hashOf(draft(over))).not.toBe(base);
    }
  });

  it("ignores what the check does not read: links, images, settings, history", () => {
    const base = hashOf(draft());
    expect(
      hashOf(
        draft({
          links: [{ to_id: "proc_x", relation: "related" }],
          banner_image_url: "https://example.test/a.png",
          voting_duration_ms: 86_400_000,
          conversation_history: [{ role: "user", content: "hi" }],
        }),
      ),
    ).toBe(base);
  });

  it("checks a vote's option labels, which residents see on the ballot", () => {
    const labels = codeOfConductFields(toDraftState(draft({ options: "Keep\nRemove" })));
    expect(labels.find((f) => f.label === "Options")?.text).toBe("Keep\nRemove");
  });
});
