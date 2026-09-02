import { describe, it, expect } from "vitest";
import {
  describeSubmissionFields,
  fieldFor,
  formatDuration,
  humanizeKey,
  parseLinkLine,
} from "../../src/shared/submissionPreview";

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("submission preview — generic content walk", () => {
  it("shows a project's banner, sources, and assistant flag", () => {
    const fields = describeSubmissionFields({
      type: "civic.project",
      title: "Skate park",
      description: "…",
      content: {
        sources: ["Grant program: https://skatepark.org/grants", "https://example.org/plan"],
        assistant_helped: true,
        banner_image_url: "https://cdn/x.webp",
        banner_image_alt: "Concrete park",
      },
    });
    const kinds = fields.map((f) => [f.key, f.kind]);
    expect(kinds).toEqual([
      ["banner_image_url", "image"],
      ["sources", "links"],
      ["assistant_helped", "flag"],
    ]);
    expect(fields[0].value).toEqual({ url: "https://cdn/x.webp", alt: "Concrete park" });
    expect(fields[1].value).toEqual([
      { label: "Grant program", url: "https://skatepark.org/grants" },
      { label: "https://example.org/plan", url: "https://example.org/plan" },
    ]);
    // the alt companion never renders on its own
    expect(fields.find((f) => f.key === "banner_image_alt")).toBeUndefined();
  });

  it("shows a proposal's links, category, and window; skips null/empty", () => {
    const fields = describeSubmissionFields({
      type: "civic.proposal",
      title: "Tool library",
      description: "…",
      content: {
        optional_links: ["https://a.example", "https://b.example"],
        category: "idea",
        assistant_helped: false,
        proposal_duration_ms: 6 * WEEK,
        considerations: null,
        sources: [],
      },
    });
    expect(fields.map((f) => f.key)).toEqual(["category", "optional_links", "proposal_duration_ms"]);
    expect(fields.find((f) => f.key === "proposal_duration_ms")).toMatchObject({
      kind: "duration",
      label: "Open for",
      value: 6 * WEEK,
    });
    expect(fields.find((f) => f.key === "assistant_helped")).toBeUndefined();
  });

  it("reaches into state for the keys a handler declares (vote)", () => {
    const fields = describeSubmissionFields(
      {
        type: "civic.vote",
        title: "Which step first?",
        description: "…",
        content: { links: [{ url: "https://x.example", label: "Study" }] },
        state: {
          method: "approval",
          options: ["A", "B", "C"],
          supporters: { user_1: true }, // internal — never requested, never shown
          config: { voting_duration_ms: 2 * WEEK, support_threshold: 5 },
        },
      },
      ["method", "options", "config.voting_duration_ms"],
    );
    expect(fields.map((f) => [f.key, f.kind])).toEqual([
      ["method", "text"],
      ["links", "links"],
      ["options", "options"],
      ["config.voting_duration_ms", "duration"],
    ]);
    expect(fields[0].value).toBe("Choose all options you approve of");
    expect(fields.find((f) => f.key === "supporters")).toBeUndefined();
  });

  it("reaches into state for a conversation's seeds, sources, window, goal", () => {
    const fields = describeSubmissionFields(
      {
        type: "civic.polis_deliberation",
        title: "Water",
        description: "…",
        content: null,
        state: {
          seed_statements: ["One", "Two"],
          sources: ["DEQ study: https://deq.example/report"],
          duration_ms: 6 * WEEK,
          participation_threshold: 50,
          polis_conversation_id: "abc",
        },
      },
      ["seed_statements", "sources", "duration_ms", "participation_threshold"],
    );
    expect(fields.map((f) => [f.key, f.kind])).toEqual([
      ["sources", "links"],
      ["seed_statements", "list"],
      ["duration_ms", "duration"],
      ["participation_threshold", "number"],
    ]);
    expect(fields.find((f) => f.key === "polis_conversation_id")).toBeUndefined();
  });

  it("never drops something a future type submits under a novel key", () => {
    const fields = describeSubmissionFields({
      type: "civic.future_thing",
      title: "New",
      description: "…",
      content: {
        venue: "Community room",
        agenda: ["Welcome", "Small groups"],
        budget: { requested: 1200, currency: "USD" },
        rsvp_url: "https://rsvp.example",
        notes: "Line one\nLine two",
      },
    });
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.venue).toMatchObject({ kind: "text", label: "Venue" });
    expect(byKey.notes).toMatchObject({ kind: "paragraph", label: "Notes" });
    expect(byKey.rsvp_url).toMatchObject({ kind: "links", label: "Rsvp url" });
    expect(byKey.agenda).toMatchObject({ kind: "list", label: "Agenda" });
    expect(byKey.budget).toMatchObject({ kind: "json" }); // last resort, still shown
    expect(fields).toHaveLength(5);
  });

  it("pulls the real URL out of a link object whose url holds the whole line", () => {
    const f = fieldFor("links", [{ url: "Trail map: https://example.org/map", label: "Trail map: https://example.org/map" }], {});
    expect(f).toMatchObject({ kind: "links", value: [{ label: "Trail map", url: "https://example.org/map" }] });
  });

  it("renders structured content sections", () => {
    const f = fieldFor("sections", [{ heading: "Background", body: "Some text" }], {});
    expect(f).toMatchObject({ kind: "sections", label: "Details" });
  });
});

describe("submission preview — helpers", () => {
  it("humanizes unknown keys and strips _ms", () => {
    expect(humanizeKey("first_meeting_ms")).toBe("First meeting");
    expect(humanizeKey("banner_image_url")).toBe("Banner image");
  });

  it("parses label: url lines, bare urls, and trailing punctuation", () => {
    expect(parseLinkLine("County site: https://floyd.gov/parks.")).toEqual({
      label: "County site",
      url: "https://floyd.gov/parks",
    });
    expect(parseLinkLine("https://a.example")).toEqual({ label: "https://a.example", url: "https://a.example" });
    expect(parseLinkLine("no link here")).toBeNull();
  });

  it("formats durations in the picker's vocabulary with a days fallback", () => {
    expect(formatDuration(2 * WEEK)).toBe("2 weeks");
    expect(formatDuration(30 * 24 * 60 * 60 * 1000)).toBe("1 month");
    expect(formatDuration(6 * WEEK)).toBe("6 weeks");
    expect(formatDuration(90 * 24 * 60 * 60 * 1000)).toBe("3 months");
    expect(formatDuration(45 * 24 * 60 * 60 * 1000)).toBe("45 days");
  });
});
