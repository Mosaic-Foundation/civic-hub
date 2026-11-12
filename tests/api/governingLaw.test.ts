// Whose law a hub's Terms use (pilot readiness 2, 2026-11-02): a place hub's own
// state, a whole state included; another kind's choice, else its location's
// state, else the platform's default, marked. Needs the operator API and the
// jurisdiction list (CI loads both).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { createHub, archiveHub } from "../fixtures/operator.js";

const run = Date.now().toString(36);
const created: string[] = [];

async function hub(tag: string, extra: Record<string, unknown>) {
  const slug = `law-${tag}-${run}`;
  const admin = `law-${tag}-${run}@example.test`;
  const res = await createHub({ slug, name: `Law ${tag}`, hostname: `${slug}.localhost`, admin_email: admin, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  return { host: `${slug}.localhost`, token: await mintSession(slug, admin) };
}

async function law(h: { host: string; token: string }) {
  const settings = await call("GET", "/admin/hub/settings", h.host, undefined, h.token);
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);
  const docs = await call("GET", "/hub-config/documents", h.host);
  return { law: settings.body.governing_law, terms: docs.body.documents["legal.terms"] as string };
}

const COUNTY = { ocd: "ocd-division/country:us/state:co/county:jefferson", name: "Jefferson County, Colorado" };
const STATE = { ocd: "ocd-division/country:us/state:co", name: "Colorado" };

beforeAll(async () => {
});

afterAll(async () => {
  for (const id of created) {
    await archiveHub(id);
  }
});

describe("a place hub's governing law", () => {
  it("is its own state, shown as such, for a county", async () => {
    const { law: l, terms } = await law(
      await hub("county", { hub_kind: "place", jurisdiction_type: "county", jurisdiction_name: COUNTY.name, jurisdiction_ocd_id: COUNTY.ocd }),
    );
    expect(l).toMatchObject({ state: "Colorado", source: "place" });
    expect(terms).toContain("governed by the laws of Colorado");
  });

  it("is its own state for a whole state, whose name has no comma", async () => {
    const { law: l, terms } = await law(
      await hub("state", { hub_kind: "place", jurisdiction_type: "other", jurisdiction_name: STATE.name, jurisdiction_ocd_id: STATE.ocd }),
    );
    expect(l).toMatchObject({ state: "Colorado", source: "place" });
    expect(terms).toContain("governed by the laws of Colorado");
  });
});

describe("another kind of hub's governing law", () => {
  it("is the platform's default, marked, with no location", async () => {
    const { law: l, terms } = await law(await hub("none", { hub_kind: "organization" }));
    expect(l.source).toBe("platform_default");
    expect(l.fallback_source).toBe("platform_default");
    expect(terms).toContain(`governed by the laws of ${l.state}`);
  });

  it("is its location's state when it has one, and its own choice over that", async () => {
    const h = await hub("located", { hub_kind: "community", jurisdiction_name: COUNTY.name, jurisdiction_ocd_id: COUNTY.ocd });
    const first = await law(h);
    expect(first.law).toMatchObject({ state: "Colorado", source: "location", fallback_source: "location" });
    expect(first.terms).toContain("governed by the laws of Colorado");

    const saved = await call("PUT", "/admin/hub/settings", h.host, { section: "legal", values: { "legal.governing_state": "Ohio" } }, h.token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const second = await law(h);
    expect(second.law).toMatchObject({ state: "Ohio", source: "setting", fallback: "Colorado" });
    expect(second.terms).toContain("governed by the laws of Ohio");
  });
});
