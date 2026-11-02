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

describe("the invite email", () => {
  const mail = renderInviteEmail({
    startHost: "start.example.test",
    code: CODE,
    linkToken: "tok123",
    email: "sam@example.test",
    expiresAt: "2026-11-13T12:00:00Z",
  });

  it("has the sign-in link, the code as text and the end date, both ways", () => {
    expect(mail.subject).toBe("Here's your invite to create a Civic Hub");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(inviteSignInLink("start.example.test", "tok123"));
      expect(body).not.toContain(inviteLink("start.example.test", CODE));
      expect(body).toContain(CODE);
      expect(body).toContain("November 13, 2026");
      expect(body).toContain("https://docs.civic.social/start/setup");
    }
  });

  it("says which way needs a second code", () => {
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("signs you in as sam@example.test, so you won't need another code");
      expect(body).toContain("we'll then email a six-digit sign-in code");
    }
  });
});
