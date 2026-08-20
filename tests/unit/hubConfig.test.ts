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
  it("refuses to boot production without an explicit space DID", () => {
    expect(() =>
      assertSpaceIdentityConfigured({ NODE_ENV: "production" }),
    ).toThrow(/CIVIC_SPACE_DID must be set in production/);
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
