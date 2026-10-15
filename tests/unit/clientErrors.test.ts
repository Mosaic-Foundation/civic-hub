// The browser's error reports (operations shell): only the listed fields are
// read from the page's body, each scrubbed, and the per-minute caps hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvent } from "../../src/utils/errorTracking.js";
import {
  allowClientError,
  readClientError,
  resetClientErrorLimitsForTests,
} from "../../src/http/clientErrors.js";

const EMAIL = "jane.resident@example.org";
const BODY = JSON.stringify({ email: EMAIL, comment: "My street floods every spring" });

beforeEach(() => resetClientErrorLimitsForTests());
afterEach(() => vi.unstubAllEnvs());

describe("a browser's report", () => {
  it("a browser's report keeps only its fields, scrubbed, and groups by message, not by the bundle's file names", () => {
    const report = readClientError({
      name: "TypeError",
      message: `x is undefined (${EMAIL})`,
      stack: "TypeError: x\n    at render (https://floyd.example/assets/index-abc123.js:1:2345)",
      path: `/process/abc?email=${EMAIL}`,
      surface: "hub",
      commit: "0123456",
      body: BODY,
      cookie: "civic_session=secret",
    });
    expect(JSON.stringify(report)).not.toContain(EMAIL);
    expect(JSON.stringify(report)).not.toContain("street floods");
    expect(JSON.stringify(report)).not.toContain("civic_session");
    expect(report?.path).toBe("/process/abc");
    const event = buildEvent({ code: "ui.error", message: report!.message, stack: report!.stack, platform: "javascript" });
    expect(event.fingerprint).toEqual(["ui.error", "Error", report!.message]);
    expect(JSON.stringify(event)).not.toContain("floyd.example");
  });

  it("is refused without a message, and its surface and commit are checked", () => {
    expect(readClientError({ name: "Error" })).toBeNull();
    expect(readClientError("not an object")).toBeNull();
    const r = readClientError({ message: "m", surface: "elsewhere", commit: "not-a-sha", name: "Type<script>Error" });
    expect(r).toMatchObject({ surface: "hub", commit: null, name: "TypescriptError" });
  });

  it("is capped at ten a minute per address and 120 per instance", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) expect(allowClientError("203.0.113.9", t)).toBe(true);
    expect(allowClientError("203.0.113.9", t)).toBe(false);
    for (let i = 0; i < 110; i++) allowClientError(`198.51.100.${i}`, t);
    expect(allowClientError("192.0.2.1", t)).toBe(false);
    expect(allowClientError("203.0.113.9", t + 60_000)).toBe(true);
  });
});
