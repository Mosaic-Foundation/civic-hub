// /health's status code (operations shell): uptime monitors read the code,
// not the body, so anything short of fully healthy must be a 503.

import { describe, expect, it } from "vitest";
import { healthVerdict } from "../../src/http/health.js";

const ok = { ok: true };
const cleanSchema = { ok: true, checked: 48, gaps: [] };

describe("healthVerdict", () => {
  it("is 200 ok only when the database, the hub's database check and the schema all pass", () => {
    expect(healthVerdict({ db: ok, hubDb: ok, schema: cleanSchema })).toEqual({ code: 200, status: "ok" });
  });

  it("is 503 degraded when the database does not answer", () => {
    expect(healthVerdict({ db: { ok: false }, hubDb: ok, schema: cleanSchema })).toEqual({ code: 503, status: "degraded" });
  });

  it("is 503 degraded when the hub's own database check fails", () => {
    expect(healthVerdict({ db: ok, hubDb: { ok: false }, schema: cleanSchema }).code).toBe(503);
  });

  it("is 503 degraded when the schema has a gap, even if the report says ok", () => {
    const gap = [{ table: "waitlist", detail: "column told_open_at missing" }];
    expect(healthVerdict({ db: ok, hubDb: ok, schema: { ok: false, checked: 48, gaps: gap } }).code).toBe(503);
    expect(healthVerdict({ db: ok, hubDb: ok, schema: { ok: true, checked: 48, gaps: gap } }).code).toBe(503);
  });
});
