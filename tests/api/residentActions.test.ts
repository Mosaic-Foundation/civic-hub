// The resident allowlist, checked centrally for every type (audit A3;
// Architecture 2: the allowlist is each manifest's actions' callers). A
// resident calling an action that is not open to residents, on a process of
// any registered type, is refused with 403 admin_required before anything
// happens: the process row and its events stay as they were. The conformance
// suite walks the types residents create; this covers every type, the ones
// only the hub creates (briefs, meeting summaries, vote results) included,
// and an action no descriptor declares.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const run = Date.now();

type PublicAction = { name: string; callers: string[] };
type PublicType = { type: string; actions: PublicAction[] };

let resident = "";
let types: PublicType[] = [];
/** Process plugins switched off on Athens before this file, switched back on here and off again after. */
let offBefore: string[] = [];

async function rowOf(id: string): Promise<{ status: string; state: unknown; version: number }> {
  const [row] = (await localRest(`processes?select=status,state,version&id=eq.${id}`)) as Array<{
    status: string;
    state: unknown;
    version: number;
  }>;
  return row;
}

async function eventCount(id: string): Promise<number> {
  return ((await localRest(`events?select=id&process_id=eq.${id}`)) as unknown[]).length;
}

const PROCESS_PLUGINS = ["vote", "proposal", "project", "brief", "announcement", "meeting_summary", "conversation", "wordcloud"];

async function setPlugins(values: Record<string, string>, admin: string): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", ATHENS, { section: "plugins", values }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

let admin = "";
/** Live copies made here of a type with no live record on Athens; removed after. */
const cloned: string[] = [];

/** A live (residents may address it) process of this type on Athens: a seeded one, or a copy of an archived one. */
async function liveOf(type: string): Promise<string> {
  const [live] = (await localRest(
    `processes?select=id&hub_id=eq.athens&type=eq.${type}&status=not.in.(pending_review,archived,draft)&limit=1`,
  )) as Array<{ id: string }>;
  if (live) return live.id;
  const [any] = (await localRest(`processes?select=*&hub_id=eq.athens&type=eq.${type}&limit=1`)) as Array<Record<string, unknown>>;
  expect(any, `a seeded ${type} on Athens`).toBeDefined();
  const id = `proc_ra_${run}_${cloned.length}`;
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({ ...any, id, status: "finalized", close_claimed_until: null }),
  });
  cloned.push(id);
  return id;
}

beforeAll(async () => {
  resident = await mintSession("athens", `resident-actions-${run}@example.test`);
  admin = await mintSession("athens", "admin+athens@example.test");
  // Every type's plugin on, so a refusal is the role check, not a switched-off type.
  const settings = (await call("GET", "/hub-config", ATHENS)).body.settings as Record<string, string>;
  offBefore = PROCESS_PLUGINS.filter((p) => settings[`plugin.${p}.enabled`] === "false");
  if (offBefore.length > 0) await setPlugins(Object.fromEntries(offBefore.map((p) => [`plugin.${p}.enabled`, "true"])), admin);
  const manifest = await call("GET", "/.well-known/civic.json", ATHENS);
  expect(manifest.status).toBe(200);
  types = manifest.body.process_types as PublicType[];
});

afterAll(async () => {
  if (cloned.length > 0) await localRest(`processes?id=in.(${cloned.join(",")})`, { method: "DELETE" });
  if (offBefore.length > 0) await setPlugins(Object.fromEntries(offBefore.map((p) => [`plugin.${p}.enabled`, "false"])), admin);
});

describe("a resident calling an action not open to residents is refused, for every type", () => {
  it("covers every registered type", () => {
    expect(types.map((t) => t.type).sort()).toEqual(
      [
        "civic.announcement",
        "civic.brief",
        "civic.event",
        "civic.meeting_summary",
        "civic.polis_deliberation",
        "civic.project",
        "civic.proposal",
        "civic.vote",
        "civic.vote_results",
        "civic.wordcloud",
      ],
    );
  });

  it("refuses each admin or hub action with 403 admin_required, and changes nothing", async () => {
    for (const t of types) {
      // A record residents may address: an archived or unreviewed one answers
      // 404 to them before any role check.
      const process = { id: await liveOf(t.type) };
      const closed = t.actions.filter((a) => !a.callers.includes("resident") && !a.callers.includes("creator"));
      for (const a of [...closed.map((x) => x.name), `undeclared.action_${run}`]) {
        const before = { row: await rowOf(process.id), events: await eventCount(process.id) };
        const res = await call("POST", `/process/${process.id}/action`, ATHENS, { type: a, payload: {} }, resident);
        expect(res.status, `${t.type} ${a}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.code, `${t.type} ${a}`).toBe("admin_required");
        expect(await rowOf(process.id), `${t.type} ${a}: the row`).toEqual(before.row);
        expect(await eventCount(process.id), `${t.type} ${a}: the events`).toBe(before.events);
      }
    }
  });
});
