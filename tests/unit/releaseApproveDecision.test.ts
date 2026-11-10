// The release's side of first-party approvals (ADR-015 amendment, console
// slice): scripts/catalog-release-approve.ts decides, per package, whether the
// release may ask the console to approve it. Only a first-party package,
// with CI green on the released commit and a pending entry whose fingerprint
// is the files at that commit, is approved; everything else stays pending.

import { describe, expect, it } from "vitest";
import { decide, type Candidate } from "../../scripts/catalog-release-approve.js";
import { isFirstPartyName, releaseCommitOf } from "../../src/shared/firstParty.js";

const H = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const events = (entries: Candidate["entries"], localHash = H): Candidate => ({
  name: "@civic-social/plugin-events",
  version: "0.4.5",
  localHash,
  entries,
});

describe("whether a release approves an entry", () => {
  it("green and matching: approved", () => {
    expect(decide(events([{ hash: H, status: "pending" }]), "success")).toEqual({ approve: true, hash: H });
  });

  it("CI red, running or missing: pending, saying which", () => {
    expect(decide(events([{ hash: H, status: "pending" }]), "failure")).toEqual({ approve: false, reason: "CI failed on this commit" });
    expect(decide(events([{ hash: H, status: "pending" }]), "running")).toMatchObject({ approve: false, reason: expect.stringContaining("not finished") });
    expect(decide(events([{ hash: H, status: "pending" }]), "missing")).toMatchObject({ approve: false, reason: expect.stringContaining("has not run") });
  });

  it("fingerprint mismatch: pending, naming both fingerprints", () => {
    const d = decide(events([{ hash: OTHER, status: "pending" }]), "success");
    expect(d.approve).toBe(false);
    expect(d).toMatchObject({ reason: expect.stringContaining("fingerprint mismatch") });
    expect((d as { reason: string }).reason).toContain(OTHER);
    expect((d as { reason: string }).reason).toContain(H);
  });

  it("third-party: pending, whatever CI says", () => {
    const d = decide({ ...events([{ hash: H, status: "pending" }]), name: "@someone/plugin-x" }, "success");
    expect(d).toEqual({ approve: false, reason: "not first-party: the operator approves it in the console" });
  });

  it("no entry, or a withdrawn one: pending", () => {
    expect(decide(events([]), "success")).toMatchObject({ approve: false, reason: expect.stringContaining("no catalog entry") });
    expect(decide(events([{ hash: H, status: "withdrawn" }]), "success")).toMatchObject({ approve: false, reason: expect.stringContaining("withdrawn") });
  });
});

describe("first-party names and release approvers", () => {
  it("is the @civic-social/ scope only", () => {
    expect(isFirstPartyName("@civic-social/plugin-events")).toBe(true);
    expect(isFirstPartyName("@civic-social-examples/plugin-straw-poll")).toBe(false);
    expect(isFirstPartyName("@test/plugin-unapproved")).toBe(false);
  });

  it("reads the commit from a release's approved_by, and none from a person's", () => {
    expect(releaseCommitOf("release@abc1234")).toBe("abc1234");
    expect(releaseCommitOf("operator@example.test")).toBeNull();
    expect(releaseCommitOf(null)).toBeNull();
  });
});
