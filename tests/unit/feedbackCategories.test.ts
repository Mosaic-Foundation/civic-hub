// The feedback category set is defined in four places and enforced in a
// fifth (the database). They cannot import from each other — the SQL is a
// migration file and the UI union is on the other side of the API — so
// nothing but this test keeps them in step.
//
// The failure mode is quiet and one-directional: add a category to the TS
// list and the form offers a pill the CHECK constraint refuses, so the
// submission 500s at insert time with the user's message already typed.
// That is the 08-22 shape again (code ahead of its migration), narrowed to
// one column.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FEEDBACK_CATEGORIES,
  FeedbackValidationError,
  submitFeedback,
} from "../../src/modules/civic.feedback/index.js";

const ROOT = join(import.meta.dirname, "../..");

/** The category list the DB will accept, read from the newest migration
 *  that (re)defines the CHECK constraint. */
function constraintCategories(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  const defining = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /ADD\s+CONSTRAINT\s+feedback_submissions_category_chk|CONSTRAINT\s+feedback_submissions_category_chk\s*\n?\s*CHECK/i.test(
        readFileSync(join(dir, f), "utf8"),
      ),
    );
  expect(defining.length).toBeGreaterThan(0);
  const newest = readFileSync(join(dir, defining[defining.length - 1]), "utf8");
  const check = newest.match(
    /feedback_submissions_category_chk[\s\S]*?CHECK\s*\(\s*category\s+IN\s*\(([^)]*)\)/i,
  );
  expect(check, "could not parse the category CHECK constraint").not.toBeNull();
  return [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The union the UI compiles against. */
function uiUnionCategories(): string[] {
  const src = readFileSync(join(ROOT, "ui/src/services/api.ts"), "utf8");
  const decl = src.match(/export type FeedbackCategory =([\s\S]*?);/);
  expect(decl, "could not find FeedbackCategory in ui/src/services/api.ts").not.toBeNull();
  return [...decl![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The pills the form actually renders, in order. */
function formPills(): Array<{ value: string; label: string }> {
  const src = readFileSync(join(ROOT, "ui/src/pages/Feedback.tsx"), "utf8");
  const decl = src.match(/const CATEGORIES:[\s\S]*?\n\];/);
  expect(decl, "could not find CATEGORIES in ui/src/pages/Feedback.tsx").not.toBeNull();
  return [
    ...decl![0].matchAll(/value:\s*"([^"]+)",\s*\n?\s*label:\s*"([^"]+)"/g),
  ].map((m) => ({ value: m[1], label: m[2] }));
}

describe("feedback categories — one set, four definitions", () => {
  it("includes topic", () => {
    expect(FEEDBACK_CATEGORIES).toContain("topic");
  });

  it("the DB constraint accepts exactly the categories the server allows", () => {
    expect(constraintCategories().sort()).toEqual([...FEEDBACK_CATEGORIES].sort());
  });

  it("the UI union matches the server list", () => {
    expect(uiUnionCategories().sort()).toEqual([...FEEDBACK_CATEGORIES].sort());
  });

  it("every category is offered as a pill, and topic reads as a suggestion", () => {
    const pills = formPills();
    expect(pills.map((p) => p.value).sort()).toEqual([...FEEDBACK_CATEGORIES].sort());
    expect(pills.find((p) => p.value === "topic")?.label).toBe("Suggest a topic");
  });
});

describe("server validation derives from FEEDBACK_CATEGORIES", () => {
  it("rejects an unknown category and names topic as a valid one", async () => {
    // Validation is the first thing submitFeedback does, so this never
    // reaches getDb() — no database required.
    await expect(
      submitFeedback({ category: "launch-idea" as never, message: "hi" }),
    ).rejects.toThrow(FeedbackValidationError);
    await expect(
      submitFeedback({ category: "launch-idea" as never, message: "hi" }),
    ).rejects.toThrow(/topic/);
  });
});
