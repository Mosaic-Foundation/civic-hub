// Breakdowns (districts and demographics, 2026-11-16), against a running hub:
// a vote's results by district and by age group from its ballot tags, shown
// only once it is closed, every group under 5 hidden, and nothing when the
// hub asks none of the questions. The vote's brief carries the same tables
// as sections. Needs the local stack and a server (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { createHub } from "../fixtures/operator.js";

const run = Date.now().toString(36);
const HUB = `bd-${run}`;
const HOST = `${HUB}.localhost`;
const ADMIN = `bd-admin-${run}@example.test`;
const DISTRICTS = [
  { id: "courthouse", name: "Courthouse" },
  { id: "little-river", name: "Little River" },
];

interface Row {
  key: string;
  label: string;
  cells: Array<number | null>;
  total: number | null;
}
interface Table {
  dimension: string;
  kind: string;
  title: string;
  columns: string[];
  rows: Row[];
}

let admin = "";
let voteId = "";

async function tables(): Promise<Table[]> {
  const res = await call("GET", `/process/${voteId}/breakdowns`, HOST);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { breakdowns: Table[] }).breakdowns;
}

beforeAll(async () => {
  const res = await createHub({ slug: HUB, name: `Breakdowns ${run}`, hostname: HOST, admin_email: ADMIN, hub_kind: "organization", mode: "beta" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  admin = await mintSession(HUB, ADMIN);
  const saved = await call(
    "PUT",
    "/admin/hub/settings",
    HOST,
    { section: "districts", values: { "about.districts": DISTRICTS, "about.district_term": "Magisterial district" } },
    admin,
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const created = await call(
    "POST",
    "/process",
    HOST,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Breakdowns ${run}`,
      description: "Breakdowns test.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  voteId = created.body.id;
  expect((await call("POST", `/process/${voteId}/action`, HOST, { type: "process.activate", payload: {} }, admin)).status).toBe(200);

  // Courthouse: 7 Yes, 6 No. Little River: 2 Yes. Not provided: 5 No.
  const voters: Array<[string | null, number, string]> = [
    ...Array.from({ length: 7 }, (): [string, number, string] => ["courthouse", 1980, "Yes"]),
    ...Array.from({ length: 6 }, (): [string, number, string] => ["courthouse", 1950, "No"]),
    ...Array.from({ length: 2 }, (): [string, number, string] => ["little-river", 1990, "Yes"]),
    ...Array.from({ length: 5 }, (): [null, number, string] => [null, 0, "No"]),
  ];
  for (const [i, [district, year, choice]] of voters.entries()) {
    const token = await mintSession(HUB, `bd-voter-${run}-${i}@example.test`);
    if (district) {
      const put = await call("PUT", "/user/about", HOST, { district_id: district, birth_year: year }, token);
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    }
    const v = await call("POST", `/process/${voteId}/action`, HOST, { type: "process.vote", payload: { option: choice } }, token);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
  }
});

describe("a vote's results by group", () => {
  it("are not shown while the vote is open", async () => {
    expect(await tables()).toEqual([]);
  });

  it("show by district once it closes, in the hub's own word, small groups hidden", async () => {
    const closed = await call("POST", `/process/${voteId}/action`, HOST, { type: "process.close", payload: { note: "Closed early by a test." } }, admin);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const all = await tables();
    expect(all.map((t) => t.dimension)).toEqual(["district", "age"]);
    const district = all[0]!;
    expect(district).toMatchObject({ kind: "results", title: "Results by magisterial district", columns: ["Yes", "No"] });
    const row = (k: string) => district.rows.find((r) => r.key === k)!;
    expect(row("courthouse")).toMatchObject({ cells: [7, 6], total: 13 });
    // Little River's 2 are hidden, and so is enough else that they can't be worked out.
    expect(row("little-river").total).toBeNull();
    expect(row("little-river").cells).toEqual([null, null]);
    // Not provided's 5 is hidden too: shown, it and Courthouse's 13 would give
    // Little River's 2 from the vote's total of 20.
    expect(row("not_provided").total).toBeNull();
    // No column is left with exactly one hidden number.
    for (let c = 0; c < 2; c++) expect(district.rows.filter((r) => r.cells[c] === null).length).not.toBe(1);
  });

  it("show by age group, never by year", async () => {
    const age = (await tables()).find((t) => t.dimension === "age")!;
    expect(age.rows.map((r) => r.key)).toEqual(["18-24", "25-34", "35-49", "50-64", "65-74", "75+", "not_provided"]);
    expect(JSON.stringify(age)).not.toMatch(/19[5-9]0/);
  });

  it("go into the vote's brief as its sections", async () => {
    const briefs = (await localRest(
      `processes?select=state&hub_id=eq.${HUB}&type=eq.civic.brief&state->>source_process_id=eq.${voteId}`,
    )) as Array<{ state: { content: { sections: Array<{ heading: string; body: string }> } } }>;
    expect(briefs.length).toBe(1);
    const section = briefs[0]!.state.content.sections.find((x) => x.heading === "Results by magisterial district");
    expect(section?.body).toMatch(/^Courthouse: Yes 7, No 6 \(13 in all\)$/m);
    expect(section?.body).toMatch(/^Little River: Fewer than 5$/m);
  });

  it("are nothing when the hub asks none of the questions", async () => {
    const off = await call(
      "PUT",
      "/admin/hub/settings",
      HOST,
      { section: "districts", values: { "about.ask_district": "false", "about.ask_birth_year": "false", "about.ask_race": "false" } },
      admin,
    );
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await tables()).toEqual([]);
  });
});
