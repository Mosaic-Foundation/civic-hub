// What a proposal draft stores and what submitting it creates (a DraftKind:
// the routes, the controller, the claim against a double submit and the Code
// of Conduct gate are the hub's, src/controllers/draftController.ts).

import { ValidationError, type Draft, DAY_MS, lines, type DraftKind } from "@civic-social/plugin-sdk/first-party";

const VALID_CATEGORIES = new Set(["issue", "idea", "project", "concern"]);
/** The proposal_drafts.proposal_duration_ms column default (6 weeks). */
const DEFAULT_PROPOSAL_DURATION_MS = 42 * DAY_MS;

export type ProposalDraft = Draft<{
  category: string | null;
  considerations: string;
  proposal_duration_ms: number;
  steward_approved: boolean | null;
}>;

export const proposalDraftKind: DraftKind<ProposalDraft> = {
  tag: "proposal",
  spec: {
    processType: "civic.proposal",
    table: "proposal_drafts",
    idPrefix: "pdraft",
    fields: {
      category: {
        write: (v) => {
          if (v && !VALID_CATEGORIES.has(String(v))) throw new ValidationError("Invalid category");
          return v;
        },
      },
      considerations: { read: (v) => (v as string | null) ?? "", write: (v) => v, checked: true },
      proposal_duration_ms: {
        write: (v) => {
          const dur = Number(v);
          // 2 weeks to 3 months: the 6-month option was retired 2026-08-28
          // when every duration-bearing type adopted the same picker.
          if (isNaN(dur) || dur < 14 * DAY_MS || dur > 90 * DAY_MS) {
            throw new ValidationError("Duration must be between 2 weeks and 3 months");
          }
          return dur;
        },
      },
      steward_approved: {},
    },
    createDefaults: (input) => ({ category: input.category ?? null }),
    generatedFields: ["considerations"],
  },
  createInput(body) {
    const category = body.category;
    if (category && !VALID_CATEGORIES.has(String(category))) {
      throw new ValidationError("Invalid category. Must be: issue, idea, or project");
    }
    return { category };
  },
  missing: (d) => (d.title.trim() ? null : "Title is required"),
  build(d) {
    let description = d.description.trim();
    if (d.considerations.trim()) {
      description = description
        ? `${description}\n\nConsiderations:\n${d.considerations.trim()}`
        : `Considerations:\n${d.considerations.trim()}`;
    }
    // A missing or NaN duration would make the closing date an Invalid Date
    // and crash toISOString(); fall back to the column default.
    const candidate = Number(d.proposal_duration_ms);
    return {
      title: d.title.trim(),
      description: description || "",
      content: {
        optional_links: lines(d.sources),
        category: d.category ?? null,
        assistant_helped: d.assistant_helped,
        proposal_duration_ms: Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_PROPOSAL_DURATION_MS,
      },
    };
  },
};
