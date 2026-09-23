import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import { getAdminEmailsSync, getBoardEmailsSync } from "../../src/services/hubSettings.js";
import { isAdminEmail } from "../../src/middleware/auth.js";
import type { Hub } from "../../src/models/hub.js";
import type { SettingsMap } from "../../src/db/hubSettingsStore.js";

/**
 * ADMINS ARE DATA, NOT DEPLOYMENT CONFIGURATION.
 *
 * `people.admin_emails` is the source of truth and CIVIC_ADMIN_EMAILS is the
 * bootstrap: the answer for a hub that has written no roster yet, which is
 * how a fresh deployment gets its first administrator. The moment a hub
 * writes one, the environment variable stops having a say in that hub.
 *
 * This matters most on a deployment serving several hubs, where one variable
 * cannot hold two answers: without the row-first rule, adding an Athens admin
 * would make them a Floyd admin too.
 *
 * These are synchronous readers, deliberately — they gate fourteen call sites,
 * several on paths that run for every visitor — so they read the snapshot the
 * resolver loaded, which is what runWithHub() puts in place here.
 */

function hub(id: string): Hub {
  return {
    id,
    hostname: `${id}.example`,
    name: `${id} hub`,
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: `did:web:${id}.example`,
    space_type: "civic-hub",
    status: "active",
    mode: "live",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}

const ENV_ADMIN = "bootstrap@example.test";
let savedAdmins: string | undefined;
let savedBoard: string | undefined;

beforeEach(() => {
  savedAdmins = process.env.CIVIC_ADMIN_EMAILS;
  savedBoard = process.env.CIVIC_BOARD_EMAILS;
  process.env.CIVIC_ADMIN_EMAILS = ENV_ADMIN;
  process.env.CIVIC_BOARD_EMAILS = "bootstrap-board@example.test";
});

afterEach(() => {
  if (savedAdmins === undefined) delete process.env.CIVIC_ADMIN_EMAILS;
  else process.env.CIVIC_ADMIN_EMAILS = savedAdmins;
  if (savedBoard === undefined) delete process.env.CIVIC_BOARD_EMAILS;
  else process.env.CIVIC_BOARD_EMAILS = savedBoard;
});

function inHub<T>(id: string, settings: SettingsMap, fn: () => T): T {
  return runWithHub(hub(id), settings, fn);
}

describe("the admin roster is the hub's own data", () => {
  it("uses the hub's row when it has one", () => {
    const admins = inHub("athens", {
      "people.admin_emails": '["moderator@athens.example"]',
    }, getAdminEmailsSync);
    expect(admins).toEqual(["moderator@athens.example"]);
    expect(admins).not.toContain(ENV_ADMIN);
  });

  it("falls back to CIVIC_ADMIN_EMAILS only when the hub has no row", () => {
    // The bootstrap. Without it a brand-new deployment has no way in.
    expect(inHub("fresh", {}, getAdminEmailsSync)).toEqual([ENV_ADMIN]);
  });

  it("gives two hubs on one deployment two different admins", () => {
    // The whole point. One environment variable cannot hold two answers.
    const floyd = inHub("floyd", {
      "people.admin_emails": '["adam@example.test"]',
    }, getAdminEmailsSync);
    const athens = inHub("athens", {
      "people.admin_emails": '["adam+athens@example.test"]',
    }, getAdminEmailsSync);
    expect(floyd).not.toEqual(athens);
    expect(
      inHub("athens", { "people.admin_emails": '["adam+athens@example.test"]' },
        () => isAdminEmail("adam@example.test")),
    ).toBe(false);
  });

  it("honours a deliberately empty roster rather than reopening the env", () => {
    // An empty list is a decision. If this fell through to the environment,
    // an operator who removed every admin would silently get the deployment's
    // bootstrap admin back — and on a shared deployment that is somebody
    // else. (The roster endpoint refuses to WRITE this state; the reader
    // still has to handle a row that already holds it.)
    expect(inHub("athens", { "people.admin_emails": "[]" }, getAdminEmailsSync))
      .toEqual([]);
  });

  it("matches case-insensitively, because email addresses do", () => {
    expect(
      inHub("athens", { "people.admin_emails": '["Moderator@Athens.Example"]' },
        () => isAdminEmail("moderator@athens.example")),
    ).toBe(true);
  });

  it("reads a legacy comma list as well as the JSON array", () => {
    // Production rows predate the encoding; both must resolve the same.
    expect(
      inHub("floyd", { "people.admin_emails": "one@example.test, two@example.test" },
        getAdminEmailsSync),
    ).toEqual(["one@example.test", "two@example.test"]);
  });

  it("scopes the board roster the same way", () => {
    expect(
      inHub("athens", { "people.board_emails": '["council@athens.example"]' },
        getBoardEmailsSync),
    ).toEqual(["council@athens.example"]);
    expect(inHub("fresh", {}, getBoardEmailsSync)).toEqual([
      "bootstrap-board@example.test",
    ]);
  });

  it("answers from the bootstrap outside a request", () => {
    // Crons and scripts have no hub in scope and always have read the
    // environment. That behaviour is unchanged.
    expect(getAdminEmailsSync()).toEqual([ENV_ADMIN]);
  });
});
