// A bug report can carry one screenshot (Adam, 2026-09-07). Only signed-in
// submitters may attach one — the upload route requires a resident — and
// only an https URL is stored. Refusals are FeedbackValidationErrors so the
// form shows the reason.

import { describe, it, expect } from "vitest";
import {
  normalizeScreenshotUrl,
  FeedbackValidationError,
} from "../../src/modules/civic.feedback/service.js";

describe("normalizeScreenshotUrl", () => {
  it("passes an https URL through for a signed-in submitter", () => {
    const u = "https://x.supabase.co/storage/v1/object/public/post-images/a.webp";
    expect(normalizeScreenshotUrl(u, "user_1")).toBe(u);
  });

  it("treats empty as no screenshot", () => {
    expect(normalizeScreenshotUrl(undefined, "user_1")).toBeNull();
    expect(normalizeScreenshotUrl("", "user_1")).toBeNull();
    expect(normalizeScreenshotUrl("   ", null)).toBeNull();
  });

  it("refuses a screenshot on an anonymous submission", () => {
    expect(() => normalizeScreenshotUrl("https://example.org/a.png", null)).toThrow(FeedbackValidationError);
    expect(() => normalizeScreenshotUrl("https://example.org/a.png", null)).toThrow("Sign in to attach a screenshot.");
  });

  it("refuses anything that is not an https URL", () => {
    for (const bad of ["http://example.org/a.png", "javascript:alert(1)", "not a url", "https://a b"]) {
      expect(() => normalizeScreenshotUrl(bad, "user_1"), bad).toThrow(FeedbackValidationError);
    }
  });
});
