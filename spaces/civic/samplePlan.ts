// Which of the Civic Hub's curated samples a hub starts with (Phase 7,
// BUILD-PLAN-multi-tenant.md "Sample content for new hubs"): the templates in
// ./sampleTemplates.ts that fit the hub's kind (identity.hub_kind) and its
// jurisdiction type, each with the process type it seeds as. The plugin that
// provides the type seeds it (kernel step 4).

import { KEYS } from "../../src/models/hubSettings.js";
import { getSettingSync } from "../../src/services/hubSettings.js";
import { isJurisdictionType } from "../../src/shared/jurisdictionType.js";
import { hubKindOf } from "../../src/shared/hubKind.js";
import { SAMPLE_TEMPLATES, templatesFor, type SampleTemplate as CivicTemplate } from "./sampleTemplates.js";
import type { SampleTemplate } from "../../src/plugins/samples.js";

/** The process type each kind of civic sample is. */
export const CIVIC_SAMPLE_TYPE: Record<CivicTemplate["kind"], string> = {
  vote: "civic.vote",
  outcome: "civic.brief",
  proposal: "civic.proposal",
  deliberation: "civic.polis_deliberation",
  project: "civic.project",
  announcement: "civic.announcement",
  meeting_summary: "civic.meeting_summary",
  wordcloud: "civic.wordcloud",
};

/** A civic template as the kernel seeds it: its type, and the vote an outcome is made from. Pure. */
export function asSample(t: CivicTemplate): SampleTemplate {
  return { ...t, type: CIVIC_SAMPLE_TYPE[t.kind], ...(t.kind === "outcome" ? { needs: t.source } : {}) };
}

/** The samples that fit the hub in scope, in seeding order. */
export function civicSamplePlan(): SampleTemplate[] {
  const typeRaw = getSettingSync(KEYS.IDENTITY_JURISDICTION_TYPE);
  const kind = hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND));
  return templatesFor(isJurisdictionType(typeRaw) ? typeRaw : null, kind).map(asSample);
}

/** Every Civic Hub sample, whichever hubs it fits. */
export function civicSamples(): SampleTemplate[] {
  return SAMPLE_TEMPLATES.map(asSample);
}
