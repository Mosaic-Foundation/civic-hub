// The waitlist signup notification — the operator's only live view of who is
// asking for access.
//
// WHAT THESE PIN DOWN
// The test-user opt-in exists so Adam can tell "add me to the list" apart from
// "let me in and I'll break things for you" without reading every note. That
// distinction is worthless if it isn't visible in the subject line, and
// dangerous if a missing or junk field reads as an opt-in — someone who never
// checked the box must never end up flagged for the beta allowlist.

import { describe, it, expect } from "vitest";
import { renderWaitlistNotification } from "../../src/services/waitlistNotify.js";
import { readTestUserFlag } from "../../src/controllers/waitlistController.js";

const base = {
  email: "resident@example.com",
  notes: null,
  wants_test_user: false,
  created_at: "2026-08-21T14:30:00.000Z",
};

describe("readTestUserFlag — only a real opt-in counts", () => {
  it("reads a checked box", () => {
    expect(readTestUserFlag(true)).toBe(true);
  });

  it("treats a missing field as not opted in", () => {
    // An older client that predates the checkbox posts no field at all.
    expect(readTestUserFlag(undefined)).toBe(false);
    expect(readTestUserFlag(null)).toBe(false);
  });

  it("does not let junk read as an opt-in", () => {
    expect(readTestUserFlag("maybe")).toBe(false);
    expect(readTestUserFlag(0)).toBe(false);
    expect(readTestUserFlag({})).toBe(false);
    expect(readTestUserFlag([])).toBe(false);
  });

  it("accepts the string encodings a form post can produce", () => {
    for (const v of ["true", "on", "1", "yes", "TRUE", " on "]) {
      expect(readTestUserFlag(v)).toBe(true);
    }
    expect(readTestUserFlag("false")).toBe(false);
  });
});

describe("renderWaitlistNotification", () => {
  it("flags the test-user opt-in in the subject line", () => {
    const { subject } = renderWaitlistNotification({
      ...base,
      wants_test_user: true,
    });
    expect(subject).toContain("TEST USER");
    expect(subject).toContain(base.email);
  });

  it("leaves the subject unflagged when the box was not checked", () => {
    const { subject } = renderWaitlistNotification(base);
    expect(subject).not.toContain("TEST USER");
    expect(subject).toContain(base.email);
  });

  it("says so in the body either way", () => {
    expect(
      renderWaitlistNotification({ ...base, wants_test_user: true }).html,
    ).toContain("Wants to be a test user");
    expect(renderWaitlistNotification(base).html).toContain(
      "Did not opt in as a test user",
    );
  });

  it("escapes notes rather than pasting them into the email as markup", () => {
    // Notes are attacker-controlled free text from an unauthenticated form.
    const { html } = renderWaitlistNotification({
      ...base,
      notes: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the email address too", () => {
    const { html } = renderWaitlistNotification({
      ...base,
      email: '<b>x</b>@example.com',
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("keeps line breaks in notes readable", () => {
    const { html } = renderWaitlistNotification({
      ...base,
      notes: "line one\nline two",
    });
    expect(html).toContain("line one<br>line two");
  });
});
