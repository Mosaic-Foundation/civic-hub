// samples: the hub's sample content, as a package serves its part of it
// (kernel step 1, Conversations 0.3.0; docs/kernel/SURFACE.md, "Samples").
// A package seeds its own samples (PluginServer.samples); a type whose sample
// needs more than the row when it is read (a conversation's statements and
// its participation picture, served without Polis) reads its template here,
// filled with this hub's names. The templates are the space type's (a
// plugin's own defaults are its own to read).

import { spaceType } from "../plugins/spaceType.js";
import { fillSample, sampleNames } from "./sampleNames.js";

export const samples = {
  /** The space type's sample template with this key, as written (its texts not filled), or undefined. */
  template(key: string): Readonly<Record<string, unknown>> | undefined {
    return spaceType()?.samples?.all().find((t) => t.key === key);
  },
  /** A sample text with this hub's names filled in (the hub in scope, read per call). */
  fill(text: string): string {
    return fillSample(text, sampleNames());
  },
};
