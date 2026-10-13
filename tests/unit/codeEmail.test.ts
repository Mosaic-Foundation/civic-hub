import { describe, expect, it } from "vitest";
import { renderCodeEmail } from "../../src/modules/civic.auth/otp.js";

// The code email (sign-in slice, 2026-10-14): phones offer the code above the
// keyboard when it sits on a line of its own after the words "code" and "is";
// the "Sign in" link is the same code as a button.

describe("the code email", () => {
  const link = "https://example.civic.social/sign-in#t=abc_DEF-123";
  const withLink = renderCodeEmail("482913", "Example Civic Hub", undefined, undefined, link);

  it("puts the code on a line of its own in the text part, right after 'Your code is:'", () => {
    const lines = withLink.text.split("\n");
    const at = lines.indexOf("482913");
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 2]).toMatch(/Your code is:$/);
    expect(lines[at - 1]).toBe("");
  });

  it("and in its own block in the HTML", () => {
    expect(withLink.html).toMatch(/<p[^>]*>482913<\/p>/);
  });

  it("has a Sign in button for the link, and the link in the text part", () => {
    expect(withLink.html).toContain(`href="${link}"`);
    expect(withLink.html).toContain(">Sign in</a>");
    expect(withLink.text).toContain(`Sign in: ${link}`);
  });

  it("has no link when none is given (step-up codes, the console, the start page)", () => {
    const plain = renderCodeEmail("482913", "Civic Social console", "finish signing in");
    expect(plain.html).not.toContain("Sign in</a>");
    expect(plain.text).not.toContain("http");
    expect(plain.text.split("\n")).toContain("482913");
  });
});
