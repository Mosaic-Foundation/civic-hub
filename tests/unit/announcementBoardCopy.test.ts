// Announcements carries its own copy of the pinned and urgent rules (kernel
// step 1), and the hub's right column reads src/shared/announcementBoard.ts
// until kernel step 3. The two copies' code stays identical until then.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const code = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("//"))
    .join("\n")
    .trim();

describe("the pinned and urgent rules", () => {
  it("are the same in Announcements and in the hub's shared copy", () => {
    expect(code("packages/civic.announcement/board.ts")).toBe(code("src/shared/announcementBoard.ts"));
  });
});
