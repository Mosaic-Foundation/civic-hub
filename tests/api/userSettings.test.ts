// A person's own settings beside the digest (design pass, 2026-10-29),
// against a running hub: "Notices about things I take part in" (decision 15)
// and Appearance (decision 9). Each is PATCHed by the signed-in person only,
// validated, and read back on /auth/me. Needs the local stack seeded as in CI
// and a server (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
let person = "";

beforeAll(async () => {
  person = await mintSession("athens", `user-settings-${Date.now()}@example.test`);
});

async function me() {
  return (await call("GET", "/auth/me", ATHENS, undefined, person)).body as {
    user: { notices_email: boolean; appearance: string; digest_frequency_days: number | null };
  };
}

describe("PATCH /user/settings/notices", () => {
  it("is on by default, turns off and on, and leaves the digest as it was", async () => {
    const before = (await me()).user;
    expect(before.notices_email).toBe(true);

    const off = await call("PATCH", "/user/settings/notices", ATHENS, { notices_email: false }, person);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ notices_email: false });
    const after = (await me()).user;
    expect(after.notices_email).toBe(false);
    expect(after.digest_frequency_days).toBe(before.digest_frequency_days);

    const on = await call("PATCH", "/user/settings/notices", ATHENS, { notices_email: true }, person);
    expect(on.body).toEqual({ notices_email: true });
  });

  it("refuses a value that is not a boolean, and a signed-out caller", async () => {
    expect((await call("PATCH", "/user/settings/notices", ATHENS, { notices_email: "no" }, person)).status).toBe(400);
    expect((await call("PATCH", "/user/settings/notices", ATHENS, { notices_email: false })).status).toBe(401);
  });
});

describe("PATCH /user/settings/appearance", () => {
  it("is light by default, and takes dark and system", async () => {
    expect((await me()).user.appearance).toBe("light");
    for (const appearance of ["dark", "system", "light"]) {
      const res = await call("PATCH", "/user/settings/appearance", ATHENS, { appearance }, person);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ appearance });
      expect((await me()).user.appearance).toBe(appearance);
    }
  });

  it("refuses anything else, and a signed-out caller", async () => {
    expect((await call("PATCH", "/user/settings/appearance", ATHENS, { appearance: "sepia" }, person)).status).toBe(400);
    expect((await call("PATCH", "/user/settings/appearance", ATHENS, { appearance: "dark" })).status).toBe(401);
  });
});
