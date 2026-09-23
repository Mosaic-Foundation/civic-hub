import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import {
  currentSender,
  parseSender,
  isSandboxSender,
  SANDBOX_SENDER,
} from "../../src/services/emailSender.js";
import type { Hub } from "../../src/models/hub.js";

/**
 * The "From" on a hub's mail: the deployment's verified address, wearing the
 * hub's own name.
 *
 * The bug behind these: the dev deployment had no RESEND_FROM, so every hub
 * on it sent as the Resend sandbox, which delivers only to the Resend account
 * owner. Admin sign-in on Athens produced a 403 and no email, and the only
 * message that did arrive was the one digest addressed to the account owner —
 * which made the sender look like it was working.
 */

function hub(id: string): Hub {
  return {
    id,
    hostname: `${id}.example`,
    name: `${id} hub`,
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: `did:web:${id}.example`,
    space_type: "civic-hub",
    status: "active",
    mode: "live",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.RESEND_FROM;
  delete process.env.RESEND_FROM;
});
afterEach(() => {
  if (saved === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = saved;
});

describe("parsing a sender", () => {
  it("splits a name and an address", () => {
    expect(parseSender("Floyd Civic Hub <noreply@civic.social>")).toEqual({
      name: "Floyd Civic Hub",
      address: "noreply@civic.social",
    });
  });

  it("reads a bare address as having no name", () => {
    expect(parseSender("noreply@civic.social")).toEqual({
      name: "",
      address: "noreply@civic.social",
    });
  });

  it("unwraps a quoted name", () => {
    expect(parseSender('"Athens Hub, demo" <a@b.test>').name).toBe(
      "Athens Hub, demo",
    );
  });

  it("recognises the provider's sandbox", () => {
    expect(isSandboxSender("onboarding@resend.dev")).toBe(true);
    expect(isSandboxSender("noreply@civic.social")).toBe(false);
    expect(isSandboxSender(parseSender(SANDBOX_SENDER).address)).toBe(true);
  });
});

describe("the name is the hub's, the address is the deployment's", () => {
  it("wears the hub's name on the deployment's address", () => {
    // The whole point. One verified address, two hubs, two names — a
    // recipient sees who wrote to them and the provider sees an address it
    // trusts.
    process.env.RESEND_FROM = "noreply@civic.social";
    const sender = runWithHub(
      hub("athens"),
      { "email.from_name": "Athens Civic Hub (demo)" },
      currentSender,
    );
    // Quoted because of the parentheses: unquoted, "(demo)" is an RFC 5322
    // comment and the recipient would see "Athens Civic Hub" with the part
    // that matters most on a demo hub quietly dropped.
    expect(sender.from).toBe('"Athens Civic Hub (demo)" <noreply@civic.social>');
  });

  it("lets the hub's name override one carried in the env value", () => {
    // RESEND_FROM is the DEPLOYMENT's, so its display name is the
    // deployment's. A hub that has named itself is not called that.
    process.env.RESEND_FROM = "Civic Hub <noreply@civic.social>";
    const sender = runWithHub(
      hub("athens"),
      { "email.from_name": "Athens Civic Hub (demo)" },
      currentSender,
    );
    expect(sender.from).toBe('"Athens Civic Hub (demo)" <noreply@civic.social>');
  });

  it("keeps the env value's name when the hub has not chosen one", () => {
    process.env.RESEND_FROM = "Floyd Civic Hub <noreply@civic.social>";
    expect(runWithHub(hub("floyd"), {}, currentSender).from).toBe(
      "Floyd Civic Hub <noreply@civic.social>",
    );
  });

  it("quotes a name containing a comma, which would otherwise split the header", () => {
    process.env.RESEND_FROM = "noreply@civic.social";
    const sender = runWithHub(
      hub("athens"),
      { "email.from_name": "Athens, VA Civic Hub" },
      currentSender,
    );
    expect(sender.from).toBe('"Athens, VA Civic Hub" <noreply@civic.social>');
  });

  it("uses a hub's own verified address where it genuinely has one", () => {
    // Still supported: a hub with its own verified sending domain sets
    // email.from_address and that wins.
    process.env.RESEND_FROM = "noreply@civic.social";
    const sender = runWithHub(
      hub("floyd"),
      {
        "email.from_address": "noreply@floyd.civic.social",
        "email.from_name": "Floyd Civic Hub",
      },
      currentSender,
    );
    expect(sender.from).toBe("Floyd Civic Hub <noreply@floyd.civic.social>");
  });

  it("falls back to the sandbox when the deployment configured nothing", () => {
    // What dev was doing for fourteen hours. The value is correct; the
    // problem is that it is almost never what anyone wants, which is why
    // sending through it now logs a warning.
    const sender = runWithHub(hub("floyd"), {}, currentSender);
    expect(isSandboxSender(sender.address)).toBe(true);
  });
});
