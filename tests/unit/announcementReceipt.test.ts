import { describe, it, expect } from "vitest";
import {
  formatAnnouncementReceipt,
  receiptRecipients,
} from "../../src/modules/civic.announcement/receipt.js";

const BASE = {
  title: "Water main work on Locust St",
  authorLabel: "Board of Supervisors",
  authorName: "Dana Reed",
  postedAt: "2026-08-27T14:05:00.000Z",
  publicUrl: "https://floyd.civic.social/announcement/proc_abc",
  hubLabel: "Floyd Civic Hub",
};

describe("receiptRecipients", () => {
  it("puts the author first, then the admins", () => {
    expect(receiptRecipients("sup@floyd.gov", "boss@floyd.gov,two@floyd.gov")).toEqual([
      "sup@floyd.gov",
      "boss@floyd.gov",
      "two@floyd.gov",
    ]);
  });

  it("sends ONE email to an admin posting under their own office", () => {
    // The dedupe that would otherwise double-send on every post an
    // admin-official makes — the exact account this feature protects.
    expect(receiptRecipients("boss@floyd.gov", "boss@floyd.gov")).toEqual([
      "boss@floyd.gov",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(receiptRecipients("Boss@Floyd.GOV", "boss@floyd.gov")).toHaveLength(1);
  });

  it("still notifies the admins when the author email is missing", () => {
    // Losing the author's address must not cost the admins their copy —
    // they are the ones who can take a fraudulent post down.
    expect(receiptRecipients(null, "boss@floyd.gov")).toEqual(["boss@floyd.gov"]);
    expect(receiptRecipients(undefined, "boss@floyd.gov")).toEqual(["boss@floyd.gov"]);
  });

  it("still notifies the author when no admins are configured", () => {
    expect(receiptRecipients("sup@floyd.gov", undefined)).toEqual(["sup@floyd.gov"]);
    expect(receiptRecipients("sup@floyd.gov", "")).toEqual(["sup@floyd.gov"]);
  });

  it("returns nobody when there is nobody to tell", () => {
    expect(receiptRecipients(null, "")).toEqual([]);
    expect(receiptRecipients("  ", "  ,  ")).toEqual([]);
  });

  it("ignores blank entries and whitespace in the admin list", () => {
    expect(receiptRecipients(null, " a@b.co , , c@d.co ")).toEqual([
      "a@b.co",
      "c@d.co",
    ]);
  });
});

describe("formatAnnouncementReceipt", () => {
  it("leads the subject with the office, not the title", () => {
    // It has to be legible in a phone notification preview to someone who
    // was not expecting it.
    const { subject } = formatAnnouncementReceipt(BASE);
    expect(subject).toBe(
      "Announcement published as Board of Supervisors — Floyd Civic Hub",
    );
  });

  it("names the poster and the office together when the name is known", () => {
    const { text } = formatAnnouncementReceipt(BASE);
    expect(text).toContain("Dana Reed (Board of Supervisors)");
  });

  it("falls back to the office alone when the name is unknown", () => {
    const { text, html } = formatAnnouncementReceipt({ ...BASE, authorName: null });
    expect(text).toContain("Board of Supervisors");
    expect(text).not.toContain("(");
    expect(html).not.toContain("null");
  });

  it("carries the compromise instruction in BOTH parts", () => {
    // The security instruction is the whole reason this email exists; a
    // text-only client must not receive a receipt without it.
    const { html, text } = formatAnnouncementReceipt(BASE);
    for (const body of [html, text]) {
      expect(body).toContain("If you did not post this");
      expect(body).toMatch(/administrator/i);
    }
  });

  it("links to the announcement in both parts", () => {
    const { html, text } = formatAnnouncementReceipt(BASE);
    expect(html).toContain(BASE.publicUrl);
    expect(text).toContain(BASE.publicUrl);
  });

  it("escapes the title — it is attacker-supplied", () => {
    // The person publishing may BE the attacker; the receipt lands in an
    // admin's inbox.
    const { html } = formatAnnouncementReceipt({
      ...BASE,
      title: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the office title too", () => {
    const { html } = formatAnnouncementReceipt({
      ...BASE,
      authorLabel: 'Board "of" Supervisors',
      authorName: null,
    });
    expect(html).toContain("&quot;of&quot;");
  });

  it("renders a readable timestamp", () => {
    const { text } = formatAnnouncementReceipt(BASE);
    expect(text).toContain("27 Aug 2026");
    expect(text).toContain("UTC");
  });

  it("falls back to the raw value on an unparseable timestamp", () => {
    // A malformed date must not produce "Invalid Date" in a security email.
    const { text } = formatAnnouncementReceipt({ ...BASE, postedAt: "not-a-date" });
    expect(text).toContain("not-a-date");
    expect(text).not.toContain("Invalid Date");
  });
});
