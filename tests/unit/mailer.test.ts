// The brief/vote-results mailer must send through the hub's one email
// provider (Resend, utils/email) — it was the last path on SMTP, and prod's
// SMTP credentials were dead while every other email worked. These pin the
// contract the approval flows rely on: one send per recipient, resolve when
// all sent, throw when any fails, log-and-resolve with no key configured.
//
// Since 2026-10-07 (review #34) it resolves with a report, and a recipient
// the hub's mode holds back is reported as held back, never as a failure.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/email.js", () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail as sendViaResend } from "../../src/utils/email.js";
import { sendEmail } from "../../src/services/mailer.js";
import { runWithHub } from "../../src/config/hubContext.js";
import type { Hub } from "../../src/models/hub.js";

function hub(mode: Hub["mode"]): Hub {
  return {
    id: "athens",
    hostname: "athens.example",
    name: "Athens hub",
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: "did:web:athens.example",
    protocol_hub_id: "civic-hub-athens",
    space_type: "civic-hub",
    status: "active",
    mode,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}
const ADMIN = { "people.admin_emails": '["a@example.gov"]' };

const mocked = vi.mocked(sendViaResend);
const message = {
  to: ["a@example.gov", "b@example.gov"],
  subject: "Civic Brief",
  html: "<p>hi</p>",
  text: "hi",
};

describe("mailer.sendEmail", () => {
  beforeEach(() => {
    mocked.mockReset();
    process.env.RESEND_API_KEY = "re_test";
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("sends one Resend message per recipient and resolves", async () => {
    mocked.mockResolvedValue({ sent: true, provider: "resend", id: "x" });
    await expect(sendEmail(message)).resolves.toEqual({
      sent: ["a@example.gov", "b@example.gov"],
      held_back: [],
    });
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls.map((c) => c[0].to)).toEqual(["a@example.gov", "b@example.gov"]);
    expect(mocked.mock.calls[0][0]).toMatchObject({ subject: "Civic Brief", html: "<p>hi</p>", text: "hi" });
  });

  it("throws 'Email delivery failed' naming the recipient when a send is refused", async () => {
    mocked
      .mockResolvedValueOnce({ sent: true, provider: "resend", id: "x" })
      .mockResolvedValueOnce({ sent: false, error: "domain not verified" });
    await expect(sendEmail(message)).rejects.toThrow(
      "Email delivery failed: b@example.gov: domain not verified",
    );
  });

  it("throws when the provider throws", async () => {
    mocked.mockRejectedValue(new Error("network down"));
    await expect(sendEmail(message)).rejects.toThrow("Email delivery failed");
  });

  it("logs and resolves when no key is configured (local dev)", async () => {
    delete process.env.RESEND_API_KEY;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendEmail(message)).resolves.toEqual({
      sent: ["a@example.gov", "b@example.gov"],
      held_back: [],
    });
    expect(mocked).not.toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).includes("To:      a@example.gov, b@example.gov"))).toBe(true);
    log.mockRestore();
  });

  it("reports a recipient a demo hub holds back, and still sends the rest", async () => {
    mocked.mockResolvedValue({ sent: true, provider: "resend", id: "x" });
    const report = await runWithHub(hub("demo"), ADMIN, () => sendEmail(message));
    expect(report).toEqual({
      sent: ["a@example.gov"],
      held_back: [{ email: "b@example.gov", reason: "this hub is in demo mode" }],
    });
    // Never offered to the provider at all.
    expect(mocked.mock.calls.map((c) => c[0].to)).toEqual(["a@example.gov"]);
  });

  it("resolves (does not throw) when every recipient is held back", async () => {
    const report = await runWithHub(hub("beta"), ADMIN, () =>
      sendEmail({ ...message, to: ["official@county.example"] }),
    );
    expect(report).toEqual({
      sent: [],
      held_back: [{ email: "official@county.example", reason: "this hub is in beta mode" }],
    });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("holds back with no key configured too, so local development shows it", async () => {
    delete process.env.RESEND_API_KEY;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const report = await runWithHub(hub("demo"), ADMIN, () => sendEmail(message));
    expect(report.held_back.map((h) => h.email)).toEqual(["b@example.gov"]);
    expect(report.sent).toEqual(["a@example.gov"]);
    log.mockRestore();
  });

  it("still throws on a real failure on a demo hub", async () => {
    mocked.mockResolvedValue({ sent: false, error: "Resend 500" });
    await expect(runWithHub(hub("demo"), ADMIN, () => sendEmail(message))).rejects.toThrow(
      "Email delivery failed: a@example.gov: Resend 500",
    );
  });
});
