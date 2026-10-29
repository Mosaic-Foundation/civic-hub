// A link stops only what it was signed for (design pass, decision 15,
// 2026-10-29): a digest's link stops the digest, a notice's link stops
// notices; every link made before notices had one is a digest link.

import { describe, expect, it } from "vitest";
import {
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} from "../../src/modules/civic.digest/unsubscribe.js";

const SECRET = "a-test-secret-of-enough-length";

describe("unsubscribe tokens carry their purpose", () => {
  it("a digest token verifies as the digest's, not as notices'", () => {
    const t = buildUnsubscribeToken("user-1", SECRET);
    expect(verifyUnsubscribeToken(t, SECRET)).toBe("user-1");
    expect(verifyUnsubscribeToken(t, SECRET, "unsub_digest")).toBe("user-1");
    expect(verifyUnsubscribeToken(t, SECRET, "unsub_notices")).toBeNull();
  });

  it("a notices token verifies as notices', not as the digest's", () => {
    const t = buildUnsubscribeToken("user-1", SECRET, "unsub_notices");
    expect(verifyUnsubscribeToken(t, SECRET, "unsub_notices")).toBe("user-1");
    expect(verifyUnsubscribeToken(t, SECRET)).toBeNull();
  });

  it("each purpose has its own address", () => {
    const base = { userId: "user-1", apiBaseUrl: "https://hub.example/", secret: SECRET };
    expect(buildUnsubscribeUrl(base)).toMatch(/^https:\/\/hub\.example\/api\/unsubscribe\/digest\?token=/);
    expect(buildUnsubscribeUrl({ ...base, purpose: "unsub_notices" })).toMatch(
      /^https:\/\/hub\.example\/api\/unsubscribe\/notices\?token=/,
    );
  });
});
