import { describe, expect, it } from "vitest";
import { planSamples } from "../../src/services/sampleSeed.js";
import { asSample, CIVIC_SAMPLE_TYPE } from "../../spaces/civic/samplePlan.js";
import { SAMPLE_TEMPLATES } from "../../spaces/civic/sampleTemplates.js";
import { sampleAnswerTimes } from "../../packages/civic.wordcloud/samples.js";
import { briefSamples } from "../../packages/civic.brief/samples.js";
import { conversationSamples } from "../../packages/civic.polis_deliberation/samples.js";
import { meetingSummarySamples } from "../../packages/civic.meeting_summary/samples.js";
import { voteSamples } from "../../packages/civic.vote/samples.js";
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

describe("what each plugin says about its own samples (kernel step 4)", () => {
  const first = (kind: string) => asSample(SAMPLE_TEMPLATES.find((t) => t.kind === kind)!);

  it("names a sample by its own field: a brief by its headline, a conversation by its topic, a meeting by its title", () => {
    expect(briefSamples.title!(first("outcome"))).toBe((first("outcome") as unknown as { headline: string }).headline);
    expect(conversationSamples.title!(first("deliberation"))).toBe((first("deliberation") as unknown as { topic: string }).topic);
    expect(meetingSummarySamples.title!(first("meeting_summary"))).toBe(
      (first("meeting_summary") as unknown as { meeting_title: string }).meeting_title,
    );
  });

  it("gives an older sample meeting summary its minutes, once", () => {
    const t = first("meeting_summary");
    const fill = (s: string) => s.toUpperCase();
    const repaired = meetingSummarySamples.repair!(t, { blocks: [] }, fill);
    expect(repaired?.sample_minutes).toBe(fill((t as unknown as { minutes: string }).minutes));
    expect(meetingSummarySamples.repair!(t, { sample_minutes: "x" }, fill)).toBeNull();
  });

  it("keeps live only what is there to show something live", () => {
    expect(voteSamples.refresh!.live(asSample(SAMPLE_TEMPLATES.find((t) => t.kind === "vote" && t.phase === "closed")!))).toBe(false);
    expect(voteSamples.refresh!.live(asSample(SAMPLE_TEMPLATES.find((t) => t.kind === "vote" && t.phase === "open")!))).toBe(true);
    expect(conversationSamples.refresh!.live(first("deliberation"))).toBe(true);
  });
});
