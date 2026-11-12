// The space-type record (console slice, 2026-11-10): one record, Civic Hub,
// that mail and the console read their names and senders from. Its values are
// what the code hard-coded before, so every hub's mail is byte-identical
// (the templates' sources were also diffed with the values put back: equal),
// and operator mail keeps the member sender until CIVIC_OPERATOR_MAIL_FROM is set.

import { afterEach, describe, expect, it } from "vitest";
import { CIVIC_HUB, currentSpaceType, spaceTypeView } from "../../src/shared/spaceTypes.js";
import { PLATFORM_CONTACT_EMAIL } from "../../src/shared/platform.js";
import { ENV_FALLBACKS, KEYS } from "../../src/models/hubSettings.js";
import { currentSender, operatorSender } from "../../src/services/emailSender.js";
import { renderFixedEmail } from "../../src/operator/platformFeedback.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["CIVIC_OPERATOR_MAIL_FROM", "RESEND_FROM"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the Civic Hub record", () => {
  it("holds what was hard-coded before", () => {
    expect(currentSpaceType()).toBe(CIVIC_HUB);
    expect(CIVIC_HUB).toMatchObject({
      displayName: "Civic Hub",
      noun: "hub",
      nounPlural: "hubs",
      domainPattern: "*.civic.social",
      supportAddress: "contact@civic.social",
      maintainer: "Civic.Social",
      memberSender: { setting: "RESEND_FROM", domain: "civic.social" },
      operatorSender: { setting: "CIVIC_OPERATOR_MAIL_FROM", domain: "civic.social" },
    });
    expect(PLATFORM_CONTACT_EMAIL).toBe("contact@civic.social");
    expect(ENV_FALLBACKS[KEYS.EMAIL_FROM_ADDRESS]).toEqual(["RESEND_FROM", "SMTP_FROM"]);
    expect(spaceTypeView()).toEqual({ id: "civic_hub", display_name: "Civic Hub", noun: "hub", noun_plural: "hubs" });
  });

  it("writes mail exactly as before", () => {
    const fixed = renderFixedEmail(
      { stream: "bug", message: "It broke." } as Parameters<typeof renderFixedEmail>[0],
      "Floyd Civic Hub",
      "https://floyd.civic.social",
    );
    expect(fixed.text).toContain("Civic.Social, which maintains the software, has marked it fixed.");
    expect(fixed.text).toContain("You get this because you said Civic.Social may contact you about it.");
  });
});

describe("the operator sender", () => {
  it("is the member sender, exactly, while CIVIC_OPERATOR_MAIL_FROM is unset", () => {
    delete process.env.CIVIC_OPERATOR_MAIL_FROM;
    process.env.RESEND_FROM = "Civic Hub <noreply@mail.civic.social>";
    expect(operatorSender()).toEqual(currentSender());
  });

  it("is that setting once set (mosaic.social, after the provider verifies it)", () => {
    process.env.RESEND_FROM = "Civic Hub <noreply@mail.civic.social>";
    process.env.CIVIC_OPERATOR_MAIL_FROM = "Mosaic <console@mail.mosaic.social>";
    expect(operatorSender()).toEqual({ name: "Mosaic", address: "console@mail.mosaic.social", from: "Mosaic <console@mail.mosaic.social>" });
    expect(currentSender().address).toBe("noreply@mail.civic.social");
  });
});
