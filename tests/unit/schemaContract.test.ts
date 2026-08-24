// The schema contract — what the running code needs the database to look like.
//
// WHAT THESE EXIST FOR
// On 2026-08-22 a deploy landed ahead of its migration. Prod ran code that
// inserts `waitlist.wants_test_user` into a table without that column, so
// POST /waitlist 500'd and — because loadSettings() awaits getWaitlist()
// inline — the whole admin settings page went down with it. GET /health said
// "ok" the entire time, because the ping proves the connection works and
// nothing more.
//
// Two properties matter, and they pull against each other:
//   1. Real drift must be reported. A silent outage is the failure mode.
//   2. A false alarm must never be reported. A check that cries wolf gets
//      ignored, and then it is worse than no check at all. The first draft of
//      this contract invented column names that did not exist and "found"
//      drift on a perfectly healthy database — hence the coverage below.

import { describe, it, expect } from "vitest";
import {
  mergeRequirements,
  collectRequirements,
  type SchemaRequirement,
} from "../../src/db/schemaContract.js";
import {
  cacheTtlFor,
  classifyProbeError,
  evaluateForbiddenProbe,
  formatSchemaReport,
  isGap,
  type SchemaReport,
} from "../../src/db/schemaCheck.js";

const req = (over: Partial<SchemaRequirement> = {}): SchemaRequirement => ({
  table: "widgets",
  owner: "core/test",
  ...over,
});

describe("mergeRequirements — one probe per table", () => {
  it("unions the columns two owners ask for", () => {
    const merged = mergeRequirements([
      req({ columns: ["a"], owner: "module.one" }),
      req({ columns: ["b"], owner: "module.two" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].columns?.sort()).toEqual(["a", "b"]);
    expect(merged[0].owner).toContain("module.one");
    expect(merged[0].owner).toContain("module.two");
  });

  it("does not duplicate a column two owners both name", () => {
    const merged = mergeRequirements([
      req({ columns: ["id", "a"] }),
      req({ columns: ["id", "b"], owner: "other" }),
    ]);
    expect(merged[0].columns?.filter((c) => c === "id")).toHaveLength(1);
  });

  it("carries forbidden columns through the merge", () => {
    // Losing these in a merge would silently drop the ballot-secrecy check.
    const merged = mergeRequirements([
      req({ columns: ["id"] }),
      req({
        owner: "civic.vote",
        forbiddenColumns: [{ column: "user_id", reason: "secrecy" }],
      }),
    ]);
    expect(merged[0].forbiddenColumns).toEqual([
      { column: "user_id", reason: "secrecy" },
    ]);
  });

  it("keeps distinct tables apart and sorts them", () => {
    const merged = mergeRequirements([req({ table: "zebra" }), req({ table: "apple" })]);
    expect(merged.map((m) => m.table)).toEqual(["apple", "zebra"]);
  });
});

describe("collectRequirements — the contract follows the plugins", () => {
  const core = [req({ table: "processes", columns: ["id"], owner: "core" })];

  it("includes storage a registered handler declares", () => {
    const contract = collectRequirements(
      [
        {
          type: "civic.wordcloud",
          requiredSchema: [
            { table: "wordcloud_submissions", columns: ["body"], owner: "civic.wordcloud" },
          ],
        },
      ],
      core,
    );
    expect(contract.map((c) => c.table)).toContain("wordcloud_submissions");
  });

  it("demands nothing for a process type this hub does not register", () => {
    // THE point of declaring schema on the handler: a hub that omits
    // civic.wordcloud has no wordcloud_submissions table and must not be told
    // it is drifting. Centralizing the list would break exactly this.
    const contract = collectRequirements([], core);
    expect(contract.map((c) => c.table)).not.toContain("wordcloud_submissions");
    expect(contract.map((c) => c.table)).toContain("processes");
  });

  it("falls back to the handler type when a requirement names no owner", () => {
    const contract = collectRequirements(
      [
        {
          type: "civic.example",
          requiredSchema: [{ table: "examples", owner: "" }],
        },
      ],
      core,
    );
    expect(contract.find((c) => c.table === "examples")?.owner).toBe("civic.example");
  });
});

describe("classifyProbeError — drift vs everything else", () => {
  it("reads 42P01 as a missing table", () => {
    const v = classifyProbeError(req(), {
      code: "42P01",
      message: 'relation "widgets" does not exist',
    });
    expect(isGap(v) && v.kind).toBe("missing_table");
  });

  it("reads 42703 as a missing column", () => {
    const v = classifyProbeError(req(), {
      code: "42703",
      message: "column widgets.shiny does not exist",
    });
    expect(isGap(v) && v.kind).toBe("missing_column");
    expect(isGap(v) && v.detail).toContain("shiny");
  });

  it("does not call a connectivity failure drift", () => {
    // Reporting "drift" for an unreachable database sends whoever reads the
    // log to the migrations folder, which is the wrong place entirely.
    const v = classifyProbeError(req(), { code: "08006", message: "connection refused" });
    expect(isGap(v)).toBe(false);
    expect(v).toEqual({ inconclusive: "connection refused" });
  });

  it("reports nothing when the probe succeeded", () => {
    expect(classifyProbeError(req(), null)).toBeNull();
  });
});

describe("evaluateForbiddenProbe — invariants held by absence", () => {
  const forbidden = { column: "user_id", reason: "ballots must stay anonymous" };

  it("flags a forbidden column that EXISTS (probe succeeds)", () => {
    const v = evaluateForbiddenProbe(req({ table: "vote_records" }), forbidden, null);
    expect(isGap(v) && v.kind).toBe("forbidden_column");
    expect(isGap(v) && v.detail).toContain("must not");
    expect(isGap(v) && v.detail).toContain("anonymous");
  });

  it("is satisfied when the column does not exist", () => {
    expect(
      evaluateForbiddenProbe(req(), forbidden, {
        code: "42703",
        message: "column vote_records.user_id does not exist",
      }),
    ).toBeNull();
  });

  it("will not claim the invariant holds when it could not check", () => {
    const v = evaluateForbiddenProbe(req(), forbidden, {
      code: "42501",
      message: "permission denied",
    });
    expect(isGap(v)).toBe(false);
    expect(v && "inconclusive" in v && v.inconclusive).toContain("could not verify");
  });
});

describe("cacheTtlFor — a red result must not outlive its fix", () => {
  const base: SchemaReport = {
    ok: true,
    checked: 27,
    gaps: [],
    inconclusive: [],
    duration_ms: 5,
  };

  it("re-probes a drifted result far sooner than a clean one", () => {
    // Someone is applying the missing migration right now. A health endpoint
    // that keeps saying "broken" for five minutes after the fix teaches
    // people to stop reading it.
    const drifted = { ...base, ok: false };
    expect(cacheTtlFor(drifted)).toBeLessThan(cacheTtlFor(base));
    expect(cacheTtlFor(drifted)).toBeLessThanOrEqual(30_000);
  });

  it("trusts a clean result for minutes, not seconds", () => {
    expect(cacheTtlFor(base)).toBeGreaterThanOrEqual(60_000);
  });
});

describe("formatSchemaReport — what a human actually reads", () => {
  const clean: SchemaReport = {
    ok: true,
    checked: 27,
    gaps: [],
    inconclusive: [],
    duration_ms: 12,
  };

  it("says so plainly when everything matches", () => {
    expect(formatSchemaReport(clean)).toContain("27 table(s) match");
  });

  it("names the table, the owner, and the missing column", () => {
    const out = formatSchemaReport({
      ...clean,
      ok: false,
      gaps: [
        {
          table: "waitlist",
          owner: "core/waitlist",
          kind: "missing_column",
          detail: "column waitlist.wants_test_user does not exist",
        },
      ],
    });
    expect(out).toContain("waitlist");
    expect(out).toContain("core/waitlist");
    expect(out).toContain("wants_test_user");
    expect(out).toContain("supabase/migrations");
  });

  it("marks an unreachable probe as not-drift", () => {
    const out = formatSchemaReport({
      ...clean,
      inconclusive: [{ table: "widgets", detail: "connection refused" }],
    });
    expect(out).toContain("not drift");
  });
});
