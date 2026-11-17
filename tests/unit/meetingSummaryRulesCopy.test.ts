// Meeting summaries carries its own copy of its rules (kernel step 1): the
// grace and quiet days, the model call's shape, and the Wix column map. The hub's job describer and
// the news sync read src/shared/meetingSummaryRules.ts until kernel step 3.
// The two copies' code stays identical until then.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const code = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("//"))
    .join("\n")
    .trim();

describe("the meeting summary's rules", () => {
  it("are the same in Meeting summaries and in the hub's shared copy", () => {
    expect(code("packages/civic.meeting_summary/rules.ts")).toBe(code("src/shared/meetingSummaryRules.ts"));
  });

  it("read a Wix column map the same way as the hub's settings save", () => {
    expect(code("packages/civic.meeting_summary/wixFields.ts")).toBe(code("src/shared/wixFields.ts"));
  });
});
