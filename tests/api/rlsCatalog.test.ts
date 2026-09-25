// Phase 3 catalog test: every table in `public` carries hub_id, has
// row-level security enabled and FORCEd, has exactly the one hub_isolation
// policy from the template, and has an index that leads with hub_id. A table
// added without any of these fails here, naming what it lacks. The rules are
// tests/fixtures/tenancyCatalog.ts; the catalog is tenancy_catalog()
// (20260925010000), read as the service role from the local stack.
//
// Also: forHub()'s HUB_TABLES list is exactly the set of hub-scoped tables
// (so a new table is reachable through forHub() only once it is also
// policed), and the post-images storage policies exist wherever storage does.

import { describe, expect, it } from "vitest";
import { localRest } from "../fixtures/adminSession.js";
import { HUB_TABLES } from "../../src/db/forHub.js";
import {
  catalogProblems,
  NOT_HUB_SCOPED,
  storagePolicyProblems,
  type CatalogRow,
} from "../fixtures/tenancyCatalog.js";

async function catalog(): Promise<CatalogRow[]> {
  return (await localRest("rpc/tenancy_catalog", { method: "POST", body: "{}" })) as CatalogRow[];
}

describe("the tenancy catalog", () => {
  it("every table: hub_id, forced RLS, the one template policy, a hub-leading index", async () => {
    const rows = await catalog();
    expect(rows.length).toBeGreaterThan(30);
    expect(catalogProblems(rows)).toEqual([]);
  });

  it("forHub()'s HUB_TABLES is exactly the set of hub-scoped tables", async () => {
    const scoped = (await catalog())
      .filter((r) => r.table_name !== "storage.objects" && !(r.table_name in NOT_HUB_SCOPED))
      .map((r) => r.table_name)
      .sort();
    expect([...HUB_TABLES].sort()).toEqual(scoped);
  });

  it("the post-images storage policies are there and key on current_hub_id()", async () => {
    expect(storagePolicyProblems(await catalog())).toEqual([]);
  });
});
