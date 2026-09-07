// The brief/vote-results mailer must send through the hub's one email
// provider (Resend, utils/email) — it was the last path on SMTP, and prod's
// SMTP credentials were dead while every other email worked. These pin the
// contract the approval flows rely on: one send per recipient, resolve when
// all sent, throw when any fails, log-and-resolve with no key configured.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/email.js", () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail as sendViaResend } from "../../src/utils/email.js";
import { sendEmail } from "../../src/services/mailer.js";

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
    await expect(sendEmail(message)).resolves.toBeUndefined();
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
    await expect(sendEmail(message)).resolves.toBeUndefined();
    expect(mocked).not.toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).includes("To:      a@example.gov, b@example.gov"))).toBe(true);
    log.mockRestore();
  });
});
