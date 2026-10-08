// Session 4 (2026-10-08): handing a hub over. The pure rules: who writes
// which setting (review R10), what a rename carries (R11), the admin invite
// (R38), the feedback address (docs #6), the console's patch parsing, and the
// page shell following a moved hub (R47).

import { describe, expect, it } from "vitest";
import {
  HANDOVER_KEYS,
  consoleOwnsHandoverKeys,
  hubSettingsUrl,
  renameFollowers,
} from "../../src/shared/settingOwners.js";
import { renderAdminInvite, describeInvites } from "../../src/services/adminInvite.js";
import { PLATFORM_CONTACT_EMAIL, PLATFORM_SETUP_GUIDE_URL, feedbackContactEmail } from "../../src/shared/platform.js";
import {
  ControlInputError,
  describeFollowOn,
  movedHostnames,
  parseConfigPatch,
  parseCreateInput,
  parseHandoverPatch,
} from "../../src/control/hubs.js";
import { isPublicKey } from "../../src/models/hubSettings.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";
import { movedToFromResponse } from "../../ui/src/config/hubConfig.js";

describe("who writes what (R10)", () => {
  it("the console sets what residents see only while the hub is a demo", () => {
    expect(consoleOwnsHandoverKeys("demo")).toBe(true);
    expect(consoleOwnsHandoverKeys("beta")).toBe(false);
    expect(consoleOwnsHandoverKeys("live")).toBe(false);
    expect(consoleOwnsHandoverKeys(null)).toBe(false);
  });

  it("every handover key is one the hub's own Settings page edits too, so the admins can always change it", () => {
    for (const key of HANDOVER_KEYS) expect(fieldSpec(key), key).toBeDefined();
  });

  it("the console no longer changes a hub's mode or its governing body from Configuration", () => {
    expect(() => parseConfigPatch({ mode: "live" })).toThrow(ControlInputError);
    expect(() => parseConfigPatch({ governing_body_short: "Council" })).toThrow(/Handover/);
    expect(parseConfigPatch({ name: "New", status: "suspended" })).toEqual({ name: "New", status: "suspended" });
  });

  it("links to the hub's own Settings section", () => {
    expect(hubSettingsUrl("x.civic.social", "mode")).toBe("https://x.civic.social/admin/settings/mode");
    expect(hubSettingsUrl("x.localhost", "legal")).toBe("http://x.localhost/admin/settings/legal");
  });
});

describe("a rename carries (R11)", () => {
  it("replaces each follower still reading the old name, and leaves one someone made their own", () => {
    const current = {
      "identity.name": "Example Civic Hub",
      "legal.operator_name": "the Town Clerk's office",
      "email.from_name": "Example Civic Hub",
    };
    expect(renameFollowers("Example Civic Hub", "Example Town Civic Hub", current)).toEqual({
      "identity.name": "Example Town Civic Hub",
      "email.from_name": "Example Town Civic Hub",
    });
  });

  it("does nothing for an empty or unchanged name", () => {
    expect(renameFollowers("A", "A", { "identity.name": "A" })).toEqual({});
    expect(renameFollowers("A", " ", { "identity.name": "A" })).toEqual({});
  });

  it("says plainly what followed, and what did not", () => {
    expect(describeFollowOn({ carried: { "email.from_name": "X", "hubs.name": "X" }, note: null })).toBe(
      "Also changed, because they still read the old name: Email from name, Registry name.",
    );
    expect(describeFollowOn({ carried: {}, note: "Only the registry name changed." })).toBe("Only the registry name changed.");
    expect(describeFollowOn({ carried: {}, note: null })).toBeNull();
  });
});

describe("the create form's ownership details (R48)", () => {
  const base = { slug: "x", name: "X Hub", hostname: "x.example.org", admin_email: "a@example.org" };

  it("takes them, validated like the hub's own Settings", () => {
    const input = parseCreateInput({
      ...base,
      ownership: { "legal.contact_email": "Help@Example.org", "email.postal_address": "PO Box 1", "legal.who_runs_this": "" },
    });
    expect(input.ownership).toEqual({ "legal.contact_email": "help@example.org", "email.postal_address": "PO Box 1" });
  });

  it("refuses a bad address in plain words, and anything that is not an ownership detail", () => {
    expect(() => parseCreateInput({ ...base, ownership: { "legal.contact_email": "not-an-email" } })).toThrow(/^Contact address/);
    expect(() => parseCreateInput({ ...base, ownership: { "identity.theme": "x" } })).toThrow(ControlInputError);
  });
});

describe("the Handover panel's write", () => {
  it("takes handover keys only, and never an empty hub name", () => {
    expect(parseHandoverPatch({ values: { "legal.operator_name": "Clerk" } })).toEqual({ "legal.operator_name": "Clerk" });
    expect(() => parseHandoverPatch({ values: { "people.admin_emails": "[]" } })).toThrow(ControlInputError);
    expect(() => parseHandoverPatch({ values: { "identity.name": "" } })).toThrow(/needs a name/);
  });
});

describe("a moved address (R47)", () => {
  it("keeps every address the hub has left, and drops one it moves back to", () => {
    expect(movedHostnames([], "x-demo.civic.social", "x.civic.social")).toEqual(["x-demo.civic.social"]);
    expect(movedHostnames(["x-demo.civic.social"], "x.civic.social", "x-demo.civic.social")).toEqual(["x.civic.social"]);
  });

  it("the page shell follows hub_moved to an http(s) origin only", () => {
    expect(movedToFromResponse(404, { error: "hub_moved", location: "https://x.civic.social" })).toBe("https://x.civic.social");
    expect(movedToFromResponse(404, { error: "hub_moved", location: "javascript:alert(1)" })).toBeNull();
    expect(movedToFromResponse(404, { error: "no_hub" })).toBeNull();
    expect(movedToFromResponse(200, { error: "hub_moved", location: "https://x.civic.social" })).toBeNull();
  });
});

describe("the feedback address (docs #6)", () => {
  it("is the hub's own, else its contact address, else the platform's", () => {
    expect(feedbackContactEmail("fb@example.org", "contact@example.org")).toBe("fb@example.org");
    expect(feedbackContactEmail("", "contact@example.org")).toBe("contact@example.org");
    expect(feedbackContactEmail(undefined, " ")).toBe(PLATFORM_CONTACT_EMAIL);
  });

  it("is public, because the Feedback page prints it", () => {
    expect(isPublicKey("plugin.feedback.contact_email")).toBe(true);
    expect(isPublicKey("plugin.feedback.recipients")).toBe(false);
  });
});

describe("the admin invite (R38)", () => {
  const invite = renderAdminInvite({ hubName: "Example Civic Hub", hubUrl: "https://example.civic.social", mode: "demo" });

  it("names the hub in the subject and links to it, its Settings and the setup guide", () => {
    expect(invite.subject).toBe("You're now an admin of Example Civic Hub");
    expect(invite.text).toContain("https://example.civic.social and sign in");
    expect(invite.text).toContain("https://example.civic.social/admin/settings");
    expect(invite.text).toContain(PLATFORM_SETUP_GUIDE_URL);
    expect(invite.html).toContain(`href="${PLATFORM_SETUP_GUIDE_URL}"`);
  });

  it("says what the mode means", () => {
    expect(invite.text).toContain("demo");
    expect(renderAdminInvite({ hubName: "H", hubUrl: "https://h", mode: "live" }).text).toContain("anyone can sign in");
  });

  it("escapes an admin-authored hub name in the HTML", () => {
    expect(renderAdminInvite({ hubName: "<b>H</b>", hubUrl: "https://h", mode: "beta" }).html).toContain("&lt;b&gt;H&lt;/b&gt;");
  });

  it("reports who was emailed and who was not", () => {
    expect(describeInvites({ sent: ["a@x.org"], not_sent: [{ email: "b@x.org", reason: "held back" }] })).toBe(
      "Sent the admin invite to a@x.org. Could not email b@x.org: held back",
    );
    expect(describeInvites({ sent: [], not_sent: [] })).toBeNull();
  });
});
