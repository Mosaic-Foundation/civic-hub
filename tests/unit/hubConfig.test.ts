/**
 * Space-identity configuration guard.
 *
 * `CIVIC_SPACE_DID` becomes `generator.id` on every activity this hub emits —
 * the identifier consumers bind provenance to, and the one value that is meant
 * to survive a change of host (Civic Activity Spec §2.2, §3.3). Deriving it
 * from BASE_URL is fine for dev, but in production it would make the space's
 * identity a function of its address: move the deployment and every consumer
 * sees a different space, with no migration activity to explain it.
 */

import { describe, it, expect } from "vitest";
import { assertSpaceIdentityConfigured } from "../../src/config/hub.js";

describe("assertSpaceIdentityConfigured", () => {
  it("boots production without CIVIC_SPACE_DID, because hubs carry their own", () => {
    // CHANGED 2026-09-22. This used to be fatal, and was right to be while a
    // deployment served exactly one space: deriving the DID from BASE_URL
    // meant moving the deployment silently minted a new identity.
    //
    // Every hub now carries `space_did` on its own row, NOT NULL, and that is
    // what gets stamped on activities — so the identity this protected is
    // guaranteed by the database instead. One deployment serving many hubs
    // could not have one correct value for the variable anyway, and refusing
    // to boot without it would block every multi-hub deployment over a value
    // nothing reads.
    expect(() =>
      assertSpaceIdentityConfigured({ NODE_ENV: "production" }),
    ).not.toThrow();
  });

  it("still refuses a malformed DID in production", () => {
    // A value that IS set has to be a DID. Garbage here would be stamped on
    // activities for any hub with no row, which is worse than absence.
    expect(() =>
      assertSpaceIdentityConfigured({
        NODE_ENV: "production",
        CIVIC_SPACE_DID: "floyd.civic.social",
      }),
    ).toThrow(/not a DID/);
  });

  it("allows the derived default outside production", () => {
    expect(() =>
      assertSpaceIdentityConfigured({ NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("accepts a well-formed DID in production", () => {
    expect(() =>
      assertSpaceIdentityConfigured({
        NODE_ENV: "production",
        CIVIC_SPACE_DID: "did:web:floyd.civic.social",
      }),
    ).not.toThrow();
  });

  it("rejects a value that is not a DID, in any environment", () => {
    for (const NODE_ENV of ["production", "development"]) {
      expect(() =>
        assertSpaceIdentityConfigured({
          NODE_ENV,
          // A URL is the plausible mistake: it is what the hub already
          // publishes as `generator.url`, and it is exactly the value that
          // must NOT become the stable identifier.
          CIVIC_SPACE_DID: "https://floyd.civic.social",
        }),
      ).toThrow(/is not a DID/);
    }
  });
});
