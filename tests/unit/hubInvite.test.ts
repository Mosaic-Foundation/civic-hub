import { describe, expect, it } from "vitest";
import { codeFromFragment, inviteLink, inviteMessage, inviteSignInLink, inviteTokenFromFragment } from "../../src/shared/hubInvite.js";
import { renderInviteEmail } from "../../src/control/inviteEmail.js";

const CODE = "AB12-CD34-EF56";

describe("the invite link", () => {
  it("carries the code in the fragment, and the start page reads it back", () => {
    const link = inviteLink("start.example.test", CODE);
    expect(link).toBe("https://start.example.test/#code=AB12-CD34-EF56");
    expect(codeFromFragment(new URL(link).hash)).toBe(CODE);
  });

  it("reads anything else as no code", () => {
    for (const hash of ["", "#", "#handoff=abc", "#code=", "#code=%E0%A4%A"]) expect(codeFromFragment(hash)).toBeNull();
  });

  it("keeps the code as text in the copied message", () => {
    const message = inviteMessage("start.example.test", CODE);
    expect(message).toContain(inviteLink("start.example.test", CODE));
    expect(message).toContain(`enter this code: ${CODE}`);
  });
});

describe("the emailed invite's sign-in link", () => {
  it("carries a token in the fragment, not the code", () => {
    const link = inviteSignInLink("start.example.test", "tok_EN-abc123");
    expect(link).toBe("https://start.example.test/#invite=tok_EN-abc123");
    expect(inviteTokenFromFragment(new URL(link).hash)).toBe("tok_EN-abc123");
    // Neither fragment reads as the other.
    expect(codeFromFragment(new URL(link).hash)).toBeNull();
    expect(inviteTokenFromFragment(`#code=${CODE}`)).toBeNull();
  });

  it("reads anything else as no token", () => {
    for (const hash of ["", "#", "#invite=", "#invite=a b", "#handoff=abc"]) expect(inviteTokenFromFragment(hash)).toBeNull();
  });
});

describe("the invite email (pilot readiness 3: the link only)", () => {
  const mail = renderInviteEmail({
    startHost: "start.example.test",
    linkToken: "tok123",
    email: "sam@example.test",
    expiresAt: "2026-11-13T12:00:00Z",
  });

  it("has the link, the address, the link's date, the guide and the questions line, both ways", () => {
    expect(mail.subject).toBe("Here's your invite to create a Civic Hub");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(inviteSignInLink("start.example.test", "tok123"));
      expect(body).toContain("Create your hub");
      expect(body).toContain("This link signs you in as sam@example.test and works until November 13, 2026.");
      expect(body).toContain("https://docs.civic.social/start/setup");
      expect(body).toContain("Questions? Write to");
    }
  });

  it("carries no code and no words about one", () => {
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toMatch(/code/i);
      expect(body).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
      expect(body).not.toContain("#code=");
    }
  });
});

describe("the code a console copies, for an invite minted without an address", () => {
  it("still carries the code and its link", () => {
    expect(inviteMessage("start.example.test", CODE)).toContain(`enter this code: ${CODE}`);
    expect(inviteMessage("start.example.test", CODE)).toContain(inviteLink("start.example.test", CODE));
  });
});
