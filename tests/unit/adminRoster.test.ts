import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import { getAdminEmailsSync, getBoardEmailsSync } from "../../src/services/hubSettings.js";
import type { Hub } from "../../src/models/hub.js";
import type { SettingsMap } from "../../src/db/hubSettingsStore.js";

/**
 * ADMINS ARE DATA, NOT DEPLOYMENT CONFIGURATION.
 *
 * `people.admin_emails` is the source of truth. Inside a hub the server's env
 * never answers for people, not even for a hub that has written no roster
 * (audit A8, 2026-10-11): that hub has no admins, and the console sets them.
 * CIVIC_ADMIN_EMAILS answers only outside a request, with no hub at all.
 *
 * This matters most on a deployment serving several hubs, where one variable
 * cannot hold two answers: without the row-first rule, adding an Athens admin
 * would make them a Floyd admin too.
 *
 * These are synchronous readers of the snapshot the resolver loaded, which is
 * what runWithHub() puts in place here. Since Architecture 4 (ADR-011) the
 * lists are the INPUT to the account-keyed grants (hub_roles) the admin check
 * reads; these tests pin how the input reads.
 */

function hub(id: string): Hub {
  return {
    id,
    hostname: `${id}.example`,
    name: `${id} hub`,
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: `did:web:${id}.example`,
    protocol_hub_id: `civic-hub-${id}`,
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

  it("never falls back to CIVIC_ADMIN_EMAILS inside a hub, even with no row", () => {
    // An env roster would make the same people admins of every hub that had
    // not saved its own. No row means no admins: requireAdmin fails closed.
    expect(inHub("fresh", {}, getAdminEmailsSync)).toEqual([]);
    expect(inHub("fresh", {}, getAdminEmailsSync)).not.toContain(ENV_ADMIN);
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
    expect(athens).not.toContain("adam@example.test");
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

  it("reads addresses lowercased, because email addresses match case-insensitively", () => {
    // The admin check itself reads account-keyed grants (hub_roles), which the
    // trigger binds by lowercased address (tests/api/hubRoles.test.ts).
    expect(
      inHub("athens", { "people.admin_emails": '["Moderator@Athens.Example"]' }, getAdminEmailsSync),
    ).toEqual(["moderator@athens.example"]);
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
    expect(inHub("fresh", {}, getBoardEmailsSync)).toEqual([]);
  });

  it("answers from env only outside a request", () => {
    // Crons and scripts have no hub in scope and always have read the
    // environment. That behaviour is unchanged.
    expect(getAdminEmailsSync()).toEqual([ENV_ADMIN]);
  });
});
