// A hub that cannot read its settings does not guess who its people are
// (audit A8, 2026-10-11). fetchHubSettings used to swallow the error and
// return {}, and resolve() then answered every key from env, so the hub's
// admin roster became CIVIC_ADMIN_EMAILS. It now throws, and the resolver
// answers 503 (tests/unit/hubResolver.test.ts).

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db/forHub.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/forHub.js")>();
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.not = async () => {
    throw new Error("connection refused");
  };
  return { ...real, forHub: () => ({ from: () => builder }) };
});

const { fetchHubSettings, HubSettingsUnavailableError } = await import("../../src/db/hubSettingsStore.js");
const { getAdminEmails } = await import("../../src/services/hubSettings.js");

describe("a settings read that fails", () => {
  it("throws HubSettingsUnavailableError instead of returning an empty map", async () => {
    await expect(fetchHubSettings("floyd")).rejects.toBeInstanceOf(HubSettingsUnavailableError);
  });

  it("never answers a hub's admins from env", async () => {
    const saved = process.env.CIVIC_ADMIN_EMAILS;
    process.env.CIVIC_ADMIN_EMAILS = "operator@example.test";
    try {
      await expect(getAdminEmails("floyd")).rejects.toBeInstanceOf(HubSettingsUnavailableError);
    } finally {
      if (saved === undefined) delete process.env.CIVIC_ADMIN_EMAILS;
      else process.env.CIVIC_ADMIN_EMAILS = saved;
    }
  });
});
