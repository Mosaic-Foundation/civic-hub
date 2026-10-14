// The console's feedback inbox: what a status or issue-link change accepts,
// and the one email a consenting sender gets when their report is fixed
// (src/control/platformFeedback.ts). Pure parts only; the API layer covers
// the database.

import { describe, expect, it } from "vitest";
import { parseFeedbackPatch, renderFixedEmail } from "../../src/control/platformFeedback.js";
import { normalizePagePath } from "../../src/modules/civic.feedback/index.js";

describe("inbox changes", () => {
  it("accepts the three statuses and a GitHub issue link", () => {
    expect(parseFeedbackPatch({ status: "planned" })).toEqual({ status: "planned" });
    expect(parseFeedbackPatch({ github_issue_url: " https://github.com/Mosaic-Foundation/civic-hub/issues/12 " })).toEqual({
      githubIssueUrl: "https://github.com/Mosaic-Foundation/civic-hub/issues/12",
    });
    expect(parseFeedbackPatch({ github_issue_url: "" })).toEqual({ githubIssueUrl: null });
  });

  it("refuses anything else", () => {
    expect(() => parseFeedbackPatch({ status: "closed" })).toThrow(/received, planned or fixed/);
    expect(() => parseFeedbackPatch({ github_issue_url: "https://example.com/issue/1" })).toThrow(/github\.com/);
    expect(() => parseFeedbackPatch({ github_issue_url: "javascript:alert(1)" })).toThrow();
    expect(() => parseFeedbackPatch({})).toThrow(/Nothing to change/);
  });
});

describe("the fixed email", () => {
  it("names the hub, quotes the report and says why it came", () => {
    const { subject, html, text } = renderFixedEmail(
      { stream: "bug", message: "The <b>map</b> is blank" },
      "Example Hub",
      "https://example.civic.social",
    );
    expect(subject).toBe("Your report on Example Hub is done");
    expect(text).toContain('You wrote: "The <b>map</b> is blank"');
    expect(html).toContain("The &lt;b&gt;map&lt;/b&gt; is blank");
    expect(text).toContain("said Civic.Social may contact you");
  });

  it("calls an idea an idea", () => {
    expect(renderFixedEmail({ stream: "feature", message: "x" }, "H", "https://h").subject).toBe("Your idea on H is done");
  });
});

describe("the page a report is about", () => {
  it("keeps a plain path and drops the query and fragment", () => {
    expect(normalizePagePath("/vote/v_1?code=123456#x")).toBe("/vote/v_1");
    expect(normalizePagePath("/")).toBe("/");
  });

  it("drops anything that is not a path on this hub", () => {
    expect(normalizePagePath("https://elsewhere.example/x")).toBeNull();
    expect(normalizePagePath("//elsewhere.example")).toBeNull();
    expect(normalizePagePath("/a b")).toBeNull();
    expect(normalizePagePath(42)).toBeNull();
  });
});
