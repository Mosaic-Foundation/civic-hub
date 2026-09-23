import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import { cronsEnabled, cronKillSwitch } from "../../src/config/cron.js";
import { mailDecision } from "../../src/services/mailGuard.js";
import type { Hub } from "../../src/models/hub.js";
import type { Request, Response, NextFunction } from "express";

/**
 * The two guards that make a second deployment of this codebase safe to
 * experiment on.
 *
 * WHAT HAPPENED. civic-hub-dev inherited vercel.json, and therefore inherited
 * every cron in it. Fourteen hours after it first deployed it had fetched a
 * county government's news feed and created five announcement processes from
 * it, and had tried to email fifty-seven people their daily digest. Fifty-six
 * of those failed only because the sender was the provider's sandbox — the
 * very thing the same session was about to replace with a verified address.
 *
 * So: crons off as a whole on that deployment, and a hub that is not live
 * writes only to the people who run it and the people it has let in.
 */

function hub(id: string, mode: Hub["mode"]): Hub {
  return {
    id,
    hostname: `${id}.example`,
    name: `${id} hub`,
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: `did:web:${id}.example`,
    space_type: "civic-hub",
    status: "active",
    mode,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}

let savedCron: string | undefined;
let savedAdmins: string | undefined;
beforeEach(() => {
  savedCron = process.env.HUB_CRON_ENABLED;
  savedAdmins = process.env.CIVIC_ADMIN_EMAILS;
  delete process.env.CIVIC_ADMIN_EMAILS;
});
afterEach(() => {
  if (savedCron === undefined) delete process.env.HUB_CRON_ENABLED;
  else process.env.HUB_CRON_ENABLED = savedCron;
  if (savedAdmins === undefined) delete process.env.CIVIC_ADMIN_EMAILS;
  else process.env.CIVIC_ADMIN_EMAILS = savedAdmins;
});

describe("HUB_CRON_ENABLED", () => {
  it("is on when nothing says otherwise", () => {
    // Production must not have to opt in to working, and an operator who has
    // never heard of this variable gets the behaviour they already had.
    delete process.env.HUB_CRON_ENABLED;
    expect(cronsEnabled()).toBe(true);
  });

  it("is off only for the exact string false", () => {
    process.env.HUB_CRON_ENABLED = "false";
    expect(cronsEnabled()).toBe(false);
    process.env.HUB_CRON_ENABLED = "FALSE";
    expect(cronsEnabled()).toBe(false);
    // Anything else is not a switch-off. "0" and "" are the values people
    // reach for by accident; neither should silently stop production's crons.
    for (const v of ["0", "", "no", "true", "yes"]) {
      process.env.HUB_CRON_ENABLED = v;
      expect(cronsEnabled(), `HUB_CRON_ENABLED=${JSON.stringify(v)}`).toBe(true);
    }
  });
});

describe("the cron kill switch", () => {
  function run(): { nexted: boolean; status: number; body: unknown } {
    const out = { nexted: false, status: 0, body: undefined as unknown };
    const res = {
      status(code: number) { out.status = code; return this; },
      type() { return this; },
      send(payload: unknown) { out.body = payload; return this; },
    } as unknown as Response;
    const req = { method: "GET", originalUrl: "/internal/digest/run" } as Request;
    cronKillSwitch(req, res, (() => { out.nexted = true; }) as NextFunction);
    return out;
  }

  it("lets the job through when crons are on", () => {
    delete process.env.HUB_CRON_ENABLED;
    expect(run().nexted).toBe(true);
  });

  it("answers 200 'disabled' and does no work when they are off", () => {
    // 200, not 503: Vercel Cron retries and alerts on a failed invocation,
    // and a deployment that is deliberately idle is not failing.
    process.env.HUB_CRON_ENABLED = "false";
    const out = run();
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(200);
    expect(out.body).toBe("disabled");
  });
});

describe("a hub that is not live writes only to its own people", () => {
  const SETTINGS = {
    "people.admin_emails": '["admin@athens.example"]',
    "beta.allowlist": '["tester@example.com"]',
  };

  it("sends to anyone when the hub is live", () => {
    expect(
      runWithHub(hub("floyd", "live"), SETTINGS, () =>
        mailDecision("stranger@example.com"),
      ).send,
    ).toBe(true);
  });

  it("suppresses a stranger on a demo hub", () => {
    const d = runWithHub(hub("athens", "demo"), SETTINGS, () =>
      mailDecision("stranger@example.com"),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toMatch(/demo mode/);
  });

  it("suppresses a stranger on a beta hub", () => {
    expect(
      runWithHub(hub("floyd", "beta"), SETTINGS, () =>
        mailDecision("stranger@example.com"),
      ).send,
    ).toBe(false);
  });

  it("still reaches the people who run the hub", () => {
    // The case the whole feature turns on: admin sign-in must work on a demo
    // hub, because a privileged account always needs a real emailed code.
    expect(
      runWithHub(hub("athens", "demo"), SETTINGS, () =>
        mailDecision("admin@athens.example"),
      ).send,
    ).toBe(true);
  });

  it("still reaches someone the hub has let in", () => {
    expect(
      runWithHub(hub("floyd", "beta"), SETTINGS, () =>
        mailDecision("tester@example.com"),
      ).send,
    ).toBe(true);
  });

  it("matches the address case-insensitively", () => {
    expect(
      runWithHub(hub("athens", "demo"), SETTINGS, () =>
        mailDecision("Admin@Athens.Example"),
      ).send,
    ).toBe(true);
  });

  it("does not guard a caller with no hub in scope", () => {
    // Crons and scripts. Stated as a test because it is a deliberate hole,
    // not an oversight: production's Floyd is in beta and its digest must
    // keep reaching its beta readers. HUB_CRON_ENABLED is what covers this
    // path on a deployment that must stay quiet.
    expect(mailDecision("stranger@example.com").send).toBe(true);
  });
});
