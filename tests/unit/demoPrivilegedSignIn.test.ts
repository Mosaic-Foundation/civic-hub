import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An official or board member can sign in to a demo hub (2026-10-07, docs
 * session #1).
 *
 * Found by reading the code: on a demo hub a privileged account must use a
 * real emailed code (privilegedAccounts.ts), but the mail guard let a demo
 * hub write only to its admin roster and allow list, and an official is on
 * neither. The code was generated, stored, and never sent.
 *
 * This runs the real requestVerification through the real utils/email and
 * the real mail guard, with a key configured, and stubs only the network
 * (fetch) and the database. The control case proves the guard is still on
 * for everything that is not a sign-in code.
 */

import { ATHENS_HUB, FLOYD_HUB } from "../fixtures/hubs/index.js";

const OFFICIAL = "official@county.example";
const ADMIN = "admin@athens.example";

vi.mock("../../src/services/privilegedAccounts.js", () => ({
  isPrivilegedEmail: async (email: string) => email.trim().toLowerCase() === OFFICIAL,
}));

// The officials list: only OFFICIAL is on it.
vi.mock("../../src/services/officials.js", () => ({
  lookupOfficialByEmail: async (email: string) =>
    email === OFFICIAL ? { official_type: "board_of_supervisors", official_title: "Chair" } : null,
}));

// pending_verifications: nothing recent, the upsert succeeds.
vi.mock("../../src/db/forHub.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/forHub.js")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = async () => null;
  builder.upsert = async () => [];
  return { ...real, forHub: () => ({ from: () => builder }) };
});

import { runWithHub } from "../../src/config/hubContext.js";
import { requestVerification } from "../../src/modules/civic.auth/index.js";
import { sendEmail } from "../../src/utils/email.js";

const SETTINGS = { "people.admin_emails": JSON.stringify([ADMIN]) };
const sentTo: string[] = [];

beforeEach(() => {
  sentTo.length = 0;
  process.env.RESEND_API_KEY = "re_test_unit_only";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sentTo.push(...(JSON.parse(init.body).to as string[]));
      return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a privileged account on a demo hub", () => {
  it("is sent its sign-in code", async () => {
    expect(ATHENS_HUB.mode).toBe("demo");
    await runWithHub(ATHENS_HUB, SETTINGS, () => requestVerification(OFFICIAL));
    expect(sentTo).toEqual([OFFICIAL]);
  });

  it("an ordinary visitor still gets no email (any six digits)", async () => {
    const res = await runWithHub(ATHENS_HUB, SETTINGS, () => requestVerification("visitor@example.com"));
    expect(res.message).toMatch(/any six digits/);
    expect(sentTo).toEqual([]);
  });

  it("anything that is not a sign-in code to the same official is still held back", async () => {
    const result = await runWithHub(ATHENS_HUB, SETTINGS, () =>
      sendEmail({ to: OFFICIAL, subject: "A brief", html: "<p>hi</p>" }),
    );
    expect(result).toMatchObject({ sent: false, held_back: true, held_back_reason: "this hub is in demo mode" });
    expect(result.error).toBeUndefined();
    expect(sentTo).toEqual([]);
  });
});

describe("an official on a beta hub (Adam, 2026-10-07)", () => {
  it("is let in as if on the allow list, and sent their code", async () => {
    expect(FLOYD_HUB.mode).toBe("beta");
    await runWithHub(FLOYD_HUB, SETTINGS, () => requestVerification(OFFICIAL));
    expect(sentTo).toEqual([OFFICIAL]);
  });

  it("someone on no list is still refused", async () => {
    await expect(
      runWithHub(FLOYD_HUB, SETTINGS, () => requestVerification("stranger@example.com")),
    ).rejects.toThrow("private beta");
    expect(sentTo).toEqual([]);
  });

  it("other mail to the official is still held back", async () => {
    const result = await runWithHub(FLOYD_HUB, SETTINGS, () =>
      sendEmail({ to: OFFICIAL, subject: "A brief", html: "<p>hi</p>" }),
    );
    expect(result).toMatchObject({ sent: false, held_back: true, held_back_reason: "this hub is in beta mode" });
  });
});
