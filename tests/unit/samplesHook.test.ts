import { describe, expect, it } from "vitest";
import { planSamples } from "../../src/services/sampleSeed.js";
import { asSample, CIVIC_SAMPLE_TYPE } from "../../spaces/civic/samplePlan.js";
import { SAMPLE_TEMPLATES } from "../../src/services/sampleTemplates.js";
import { sampleAnswerTimes } from "../../packages/civic.wordcloud/samples.js";
import type { SampleTemplate } from "../../src/plugins/samples.js";

const t = (key: string, type: string, extra: Partial<SampleTemplate> = {}): SampleTemplate => ({ key, type, ...extra });
const always = () => true;

describe("the kernel's sample plan (kernel step 3)", () => {
  it("seeds the space type's samples, then a plugin's defaults for a type the space type brings none of", () => {
    const { plan, skipped } = planSamples({
      fromSpace: [t("v1", "civic.vote"), t("w1", "civic.wordcloud")],
      defaults: [
        { type: "civic.wordcloud", templates: [{ key: "w_default" }] },
        { type: "acme.poll", templates: [{ key: "poll_1", by: "ALEX" }] },
      ],
      canSeed: always,
    });
    expect(plan.map((p) => p.key)).toEqual(["v1", "w1", "poll_1"]);
    expect(plan[2]).toEqual({ key: "poll_1", by: "ALEX", type: "acme.poll" });
    expect(skipped).toEqual([]);
  });

  it("skips a sample whose key is taken, whose type nothing seeds, or whose source is not planned", () => {
    const { plan, skipped } = planSamples({
      fromSpace: [t("a", "x.one"), t("brief", "x.brief", { needs: "gone" }), t("b", "x.none")],
      defaults: [{ type: "x.two", templates: [{ key: "a" }] }],
      canSeed: (s) => s.type !== "x.none",
    });
    expect(plan.map((p) => p.key)).toEqual(["a"]);
    expect(skipped.map((s) => s.key)).toEqual(["brief", "b", "a"]);
  });

  it("narrows to the keys asked for, and an outcome alone is skipped without its vote (the refresh)", () => {
    const fromSpace = [t("vote", "civic.vote"), t("outcome", "civic.brief", { needs: "vote" })];
    expect(planSamples({ fromSpace, defaults: [], only: ["vote", "outcome"], canSeed: always }).plan).toHaveLength(2);
    expect(planSamples({ fromSpace, defaults: [], only: ["outcome"], canSeed: always }).skipped[0]!.key).toBe("outcome");
  });
});

describe("the Civic Hub's samples, as the kernel seeds them", () => {
  it("gives every curated template its type, and an outcome the vote it is made from", () => {
    for (const tpl of SAMPLE_TEMPLATES) {
      const s = asSample(tpl);
      expect(s.type).toBe(CIVIC_SAMPLE_TYPE[tpl.kind]);
      if (tpl.kind === "outcome") expect(s.needs).toBe(tpl.source);
      else expect(s.needs).toBeUndefined();
    }
  });
});

describe("Word clouds' sample answers", () => {
  it("spread between its opening and now, interleaved", () => {
    const times = sampleAnswerTimes(4, 0, 5000).map((s) => Date.parse(s));
    expect(times.every((x) => x > 0 && x < 5000)).toBe(true);
    expect(new Set(times).size).toBe(4);
  });
});
