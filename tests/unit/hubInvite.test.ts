import { describe, expect, it } from "vitest";
import { codeFromFragment, inviteLink, inviteMessage } from "../../src/shared/hubInvite.js";
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

describe("the invite email", () => {
  const mail = renderInviteEmail({ startHost: "start.example.test", code: CODE, expiresAt: "2026-11-13T12:00:00Z" });

  it("has the link, the code as text and the end date, both ways", () => {
    expect(mail.subject).toBe("Here's your invite to create a Civic Hub");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(inviteLink("start.example.test", CODE));
      expect(body).toContain(CODE);
      expect(body).toContain("November 13, 2026");
      expect(body).toContain("https://docs.civic.social/start/setup");
    }
  });
});
