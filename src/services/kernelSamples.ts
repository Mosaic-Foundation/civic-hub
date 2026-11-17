// samples: the hub's sample content, as a package serves its part of it
// (kernel step 1, Conversations 0.3.0; docs/kernel/SURFACE.md, "Samples").
// The kernel seeds a hub's sample processes from its templates
// (src/services/sampleSeed.ts); a type whose sample needs more than the row
// (a conversation's statements and its participation picture, served without
// Polis) reads its template here, filled with this hub's names.

import { SAMPLE_TEMPLATES, fillSample } from "./sampleTemplates.js";
import { sampleNames } from "./sampleNames.js";

export const samples = {
  /** The sample template with this key, as written (its texts not filled), or undefined. */
  template(key: string): Readonly<Record<string, unknown>> | undefined {
    return SAMPLE_TEMPLATES.find((t) => t.key === key) as Readonly<Record<string, unknown>> | undefined;
  },
  /** A sample text with this hub's names filled in (the hub in scope, read per call). */
  fill(text: string): string {
    return fillSample(text, sampleNames());
  },
};
