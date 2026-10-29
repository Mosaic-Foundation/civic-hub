// Parity: the authorization seam answers every question exactly as the email
// checks it replaced did (Architecture 4, ADR-011; "nobody's access changes").
//
// The old rules are frozen in tests/fixtures/authz/oldRules.ts (a104260's
// code, by address against the people lists). The new answer is the real
// seam (actorFor + canActor, reading hub_roles through the cache) run in this
// process against the local stack. For every person on the hubs below, with a
// code-proved session (and a demo one for people who hold no role: the only
// demo sessions that can exist), every hub question, every action every
// registered type declares, as its creator and not, must agree on allowed,
// refusal code, caller and authorship.
//
// Hubs: a scratch hub walked through five people-list configurations (admins
// with a pending one, board as fallback authors, a legacy author list with a
// curated name, officials migrated or not, an empty roster, a corrupt author
// list), and Athens and Floyd as the local stack has them.
//
// Kept until the people lists stop being the input to hub_roles (Adam, Q5).
// LOCAL ONLY: pg and the service role on the local stack.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { localStack } from "../fixtures/adminSession.js";
import * as old from "../fixtures/authz/oldRules.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`authzParity: refusing ${host}; local stack only.`);
}
// The seam reads through forHub(), which needs the stack's URL and key; the
// API step of CI does not export them, so name the local stack's (refused
// unless it is this machine).
const stack = localStack();
process.env.SUPABASE_URL = stack.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.key;

const { actorFor } = await import("../../src/authz/actor.js");
const { canActor, callerMayCall, subjectIsOfficial, publishesAtOnce } = await import("../../src/authz/canActor.js");
const { withHubScope } = await import("../../src/config/hubContext.js");
const { invalidateHubRoles } = await import("../../src/db/hubRolesStore.js");
const { invalidateHubSettings } = await import("../../src/db/hubSettingsStore.js");
const { MANIFEST_LIST } = await import("../../src/shared/processManifests.js");
const { inferOfficialType } = await import("../../src/shared/officialTypes.js");

type Assurance = "code" | "demo";
type HubAction = import("../../src/authz/canActor.js").HubAction;
type User = import("../../src/modules/civic.auth/index.js").User;

let db: pg.Client;
const scratch = `ap-${randomBytes(4).toString("hex")}`;
let compared = 0;

interface Person {
  label: string;
  row: { id: string; email: string; is_resident: boolean; full_name: string | null; official_type: string | null; official_title: string | null };
}

async function hubRow(id: string) {
  return (await db.query("SELECT * FROM hubs WHERE id = $1", [id])).rows[0];
}

async function settingsOf(id: string): Promise<Record<string, string>> {
  const rows = (await db.query<{ key: string; value: string }>("SELECT key, value FROM hub_settings WHERE hub_id = $1", [id])).rows;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** The managed office the OLD code found: a users row looked up by address. */
async function officialByEmail(hubId: string, email: string): Promise<old.OldOfficial | null> {
  const r = (await db.query("SELECT official_type, official_title FROM users WHERE hub_id = $1 AND email = $2", [hubId, email.trim().toLowerCase()])).rows[0];
  return r?.official_type && r?.official_title ? { type: r.official_type, title: r.official_title } : null;
}

function toUser(p: Person): User {
  return {
    id: p.row.id, email: p.row.email, email_verified: true, is_resident: p.row.is_resident, created_at: "",
    digest_frequency_days: null, last_digest_sent_at: null, tos_version_accepted: null, tos_accepted_at: null,
    notices_email: true, appearance: "light",
    hide_ai_drafting_help: false, hidden_from_members: false, display_name: null, full_name: p.row.full_name,
  };
}

type Answer = { allowed: boolean; code?: string; caller?: string; authorship?: unknown; official?: unknown };

function fromOld(a: old.OldAnswer): Answer {
  if (!a.allowed) return { allowed: false, code: a.code };
  const out: Answer = { allowed: true };
  if (a.caller) out.caller = a.caller;
  if (a.authorship !== undefined) out.authorship = a.authorship;
  if (a.official !== undefined) out.official = a.official;
  return out;
}

/** Compare every question for every person on one hub as it stands now. */
async function walk(hubId: string, people: Person[]): Promise<string[]> {
  invalidateHubRoles(hubId);
  invalidateHubSettings(hubId);
  const hub = await hubRow(hubId);
  const settings = await settingsOf(hubId);
  const problems: string[] = [];
  const note = (what: string, a: unknown, b: unknown) => {
    compared += 1;
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${hubId} ${what}: old ${JSON.stringify(a)} new ${JSON.stringify(b)}`);
  };

  await withHubScope(hub, settings, async () => {
    for (const p of people) {
      const user = old.isAdminEmail(settings, p.row.email) || (await officialByEmail(hubId, p.row.email)) || old.resolveAuthorship(settings, p.row.email, null, inferOfficialType)
        ? ["code"]
        : ["code", "demo"];
      const managed = await officialByEmail(hubId, p.row.email);
      const oldUser: old.OldUser = { id: p.row.id, email: p.row.email, is_resident: p.row.is_resident, full_name: p.row.full_name };
      for (const assurance of user as Assurance[]) {
        const actor = await actorFor(toUser(p), assurance);
        const who = `${p.label} (${assurance})`;
        const ask = async (action: HubAction): Promise<Answer> => {
          const d = await canActor(actor, action);
          if (!d.allowed) return { allowed: false, code: d.error.code };
          const out: Answer = { allowed: true };
          if (d.authorship) out.authorship = d.authorship;
          if (d.official) out.official = d.official;
          return out;
        };

        note(`${who} requireResident`, fromOld(old.requireResident(oldUser)), await ask("hub.participate"));
        note(`${who} requireAdmin`, fromOld(old.requireAdmin(settings, oldUser, assurance)), await ask("hub.administer"));
        note(
          `${who} requireAnnouncementPoster`,
          fromOld(old.requireAnnouncementPoster(settings, oldUser, assurance, managed, inferOfficialType)),
          await ask("announcement.post"),
        );
        note(
          `${who} requireOfficial`,
          fromOld(old.requireOfficial(settings, oldUser, assurance, managed, inferOfficialType)),
          await ask("office.respond"),
        );
        if (assurance === "code") {
          // Read paths that show an admin more, and the review's auto-approval.
          note(`${who} isAdmin (reads)`, old.isAdminEmail(settings, p.row.email), (await canActor(actor, "hub.see_as_admin")).allowed);
          note(`${who} isAdmin (changes)`, old.isAdminEmail(settings, p.row.email), (await canActor(actor, "hub.administer")).allowed);
          // /auth/me and the sign-in answer: authorship whatever the guard.
          const { authorshipOf } = await import("../../src/authz/canActor.js");
          note(`${who} /auth/me authorship`, old.resolveAuthorship(settings, p.row.email, managed, inferOfficialType), await authorshipOf(actor));
        }

        // Who skips the review wait: an admin, as before, on every type; an
        // official only where the type says so (A6, the deliberate addition).
        for (const m of assurance === "code" ? MANIFEST_LIST : []) {
          const at = await publishesAtOnce(actor, m.descriptor.creation.resident);
          note(`${who} ${m.descriptor.type} publishes at once (admin)`, old.isAdminEmail(settings, p.row.email), at.admin);
          const declaresOfficial = Boolean(m.descriptor.creation.resident?.publish_at_once?.includes("official"));
          note(`${who} ${m.descriptor.type} publishes at once (official)`, !at.admin && declaresOfficial && (await subjectIsOfficial(p.row.id)), at.official);
        }

        // Every action of every type, as the route (requireResident) lets it through.
        if (!p.row.is_resident || !p.row.full_name) continue;
        for (const m of MANIFEST_LIST) {
          for (const declared of m.descriptor.actions) {
            for (const mine of [false, true]) {
              const process = {
                id: "proc_parity", definition: { type: m.descriptor.type, version: "1" }, title: "", description: "",
                status: "active", hubId, jurisdiction: "", createdBy: mine ? p.row.id : "user_someone_else",
                createdAt: "", updatedAt: "", state: {},
              } as never;
              const label = `${who} ${m.descriptor.type} ${declared.name}${mine ? " (creator)" : ""}`;
              const oldCaller = old.actOnProcessCaller(settings, oldUser);
              const d = await canActor(actor, "process.act", { process, action: declared.name });
              const newCaller = d.allowed ? d.caller : `refused:${d.error.code}`;
              // A demo session never reaches actOnProcess as an admin today
              // (civic.auth refuses demo sessions for privileged addresses).
              if (assurance === "code") note(`${label} caller`, oldCaller, newCaller);
              const callerNow = d.allowed ? d.caller! : "resident";
              // The one deliberate addition (engine 2, A6): an action a type
              // opens to officials, for an account holding a managed office.
              const isOfficial = await subjectIsOfficial(p.row.id);
              const opensToOfficial = (declared.callers as readonly string[]).includes("official") && isOfficial;
              const oldMay = oldCaller !== "resident" || old.residentMayCall(declared, mine ? p.row.id : "user_someone_else", p.row.id) || opensToOfficial;
              const official = callerNow === "resident" && (declared.callers as readonly string[]).includes("official") && isOfficial;
              if (assurance === "code") note(`${label} may call`, oldMay, callerMayCall(callerNow, declared, process, p.row.id, official));
              // process.see_unpublished: an admin finds a non-public process.
              if (assurance === "code" && declared === m.descriptor.actions[0] && !mine) {
                note(`${who} see_unpublished`, old.isAdminEmail(settings, p.row.email), (await canActor(actor, "process.see_unpublished", { process })).allowed);
              }
            }
          }
        }
      }
    }
  });
  return problems;
}

async function peopleOn(hubId: string, limit: number): Promise<Person[]> {
  const settings = await settingsOf(hubId);
  const named = new Set<string>();
  for (const key of ["people.admin_emails", "people.board_emails"]) {
    for (const e of (settings[key] ?? "").toLowerCase().match(/[^\][\s",;{}:<>]+@[^\][\s",;{}:<>]+/g) ?? []) named.add(e);
  }
  for (const e of (settings["people.announcement_authors"] ?? settings["announcement_authors"] ?? "").toLowerCase().match(/[^\][\s",;{}:<>]+@[^\][\s",;{}:<>]+/g) ?? []) named.add(e);
  const listed = (await db.query("SELECT * FROM users WHERE hub_id = $1 AND (lower(email) = ANY($2) OR official_type IS NOT NULL) ORDER BY id", [hubId, [...named]])).rows;
  const residents = (await db.query("SELECT * FROM users WHERE hub_id = $1 AND is_resident AND full_name IS NOT NULL ORDER BY id LIMIT $2", [hubId, limit])).rows;
  const others = (await db.query("SELECT * FROM users WHERE hub_id = $1 AND (NOT is_resident OR full_name IS NULL) ORDER BY id LIMIT $2", [hubId, limit])).rows;
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const row of [...listed, ...residents, ...others]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ label: row.id, row });
  }
  return out;
}

// --- the scratch hub ----------------------------------------------------------

const P: Record<string, Person> = {};

async function person(label: string, email: string, over: Partial<Person["row"]> = {}): Promise<void> {
  const row = {
    id: `user_${randomBytes(6).toString("hex")}`, email, is_resident: true, full_name: `${label} Name`,
    official_type: null as string | null, official_title: null as string | null, ...over,
  };
  await db.query(
    "INSERT INTO users (id, hub_id, email, email_verified, is_resident, full_name, official_type, official_title) VALUES ($1,$2,$3,true,$4,$5,$6,$7)",
    [row.id, scratch, row.email, row.is_resident, row.full_name, row.official_type, row.official_title],
  );
  P[label] = { label, row };
}

async function set(key: string, value: string | null): Promise<void> {
  if (value === null) await db.query("DELETE FROM hub_settings WHERE hub_id = $1 AND key = $2", [scratch, key]);
  else await db.query("INSERT INTO hub_settings (hub_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (hub_id, key) DO UPDATE SET value = EXCLUDED.value", [scratch, key, value]);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("INSERT INTO hubs (id, hostname, name, space_did, protocol_hub_id, mode) VALUES ($1,$2,'Parity Hub',$3,$1,'live')", [
    scratch, `${scratch}.localhost`, `did:web:${scratch}.localhost`,
  ]);
  await person("admin", "Admin@Parity.Test");
  await person("admin-unnamed-outsider", "outside-admin@parity.test", { is_resident: false, full_name: null });
  await person("admin-official", "chair@parity.test", { official_type: "board_of_supervisors", official_title: "Chair, Board of Supervisors" });
  await person("official", "supervisor@parity.test", { official_type: "board_of_supervisors", official_title: "Board of Supervisors" });
  await person("board", "board@parity.test");
  await person("legacy-author", "clerk@parity.test");
  await person("member", "member@parity.test");
  await person("member-unnamed", "unnamed@parity.test", { full_name: null });
  await person("outsider", "outsider@parity.test", { is_resident: false });
});

afterAll(async () => {
  if (db) {
    await db.query("DELETE FROM hub_settings WHERE hub_id = $1", [scratch]);
    await db.query("DELETE FROM users WHERE hub_id = $1", [scratch]);
    await db.query("DELETE FROM hubs WHERE id = $1", [scratch]);
    await db.end();
  }
});

describe("the seam answers as the email checks did", () => {
  it("admins (one pending), the board as fallback authors, officials not migrated", async () => {
    await set("people.admin_emails", JSON.stringify(["admin@parity.test", "OUTSIDE-ADMIN@parity.test", "chair@parity.test", "not-signed-up@parity.test"]));
    await set("people.board_emails", "board@parity.test, clerk@parity.test");
    await set("people.officials_migrated", null);
    expect(await walk(scratch, Object.values(P))).toEqual([]);
  });

  it("a legacy author list with a curated name, not migrated", async () => {
    await set("people.announcement_authors", JSON.stringify([{ email: "Clerk@Parity.Test", label: "Planning Committee", name: "Pat" }, { email: "member@parity.test", label: "Guest speaker" }]));
    expect(await walk(scratch, Object.values(P))).toEqual([]);
  });

  it("the same with the officials migrated (the legacy tier switched off)", async () => {
    await set("people.officials_migrated", "true");
    expect(await walk(scratch, Object.values(P))).toEqual([]);
  });

  it("a corrupt author list (the board stands in) and the legacy key", async () => {
    await set("people.officials_migrated", null);
    await set("people.announcement_authors", null);
    await set("announcement_authors", "{not json");
    expect(await walk(scratch, Object.values(P))).toEqual([]);
    await set("announcement_authors", null);
  });

  it("an empty roster fails closed for everyone", async () => {
    await set("people.admin_emails", "[]");
    expect(await walk(scratch, Object.values(P))).toEqual([]);
  });

  it("a pending admin who signs up is an admin at once", async () => {
    await set("people.admin_emails", JSON.stringify(["late@parity.test"]));
    await person("late-admin", "late@parity.test");
    expect(await walk(scratch, Object.values(P))).toEqual([]);
  });

  it("Athens and Floyd as the stack has them", async () => {
    for (const hubId of ["athens", "floyd"]) {
      if (!(await hubRow(hubId))) continue;
      expect(await walk(hubId, await peopleOn(hubId, 15))).toEqual([]);
    }
  });

  it("compared a real number of answers", () => {
    // Every registered type's every action for every eligible person, five
    // configurations and two seeded hubs: thousands, never a handful.
    // CIVIC_PARITY_REPORT=<file> records the count (for a session report).
    if (process.env.CIVIC_PARITY_REPORT) writeFileSync(process.env.CIVIC_PARITY_REPORT, `${compared}\n`);
    expect(compared).toBeGreaterThan(2000);
  });
});
