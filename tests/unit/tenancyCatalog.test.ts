// The catalog rules fail on the tables they exist to catch. The real schema
// is checked by tests/api/rlsCatalog.test.ts; this proves the checker is not
// vacuous, with no database.

import { describe, expect, it } from "vitest";
import {
  catalogProblems,
  HUB_POLICY_EXPR,
  storagePolicyProblems,
  type CatalogRow,
} from "../fixtures/tenancyCatalog.js";

const policy = {
  name: "hub_isolation",
  cmd: "*",
  permissive: true,
  roles: ["authenticated"],
  using: HUB_POLICY_EXPR,
  with_check: HUB_POLICY_EXPR,
};
const good = (table_name: string): CatalogRow => ({
  table_name,
  has_hub_id: true,
  rls_enabled: true,
  rls_forced: true,
  hub_leading_index: true,
  policies: [policy],
});
const registry: CatalogRow = { ...good("hubs"), has_hub_id: false, hub_leading_index: false, policies: [] };

describe("catalogProblems", () => {
  it("passes a catalog that meets the rules", () => {
    expect(catalogProblems([good("processes"), good("events"), registry])).toEqual([]);
  });

  it("fails a table added with no hub_id, no policy and no index", () => {
    const added: CatalogRow = {
      table_name: "new_things",
      has_hub_id: false,
      rls_enabled: false,
      rls_forced: false,
      hub_leading_index: false,
      policies: [],
    };
    const problems = catalogProblems([good("processes"), added]);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^new_things: no hub_id/),
        expect.stringMatching(/^new_things: row-level security is not enabled/),
        expect.stringMatching(/^new_things: row-level security is not FORCEd/),
        expect.stringMatching(/^new_things: no hub_isolation policy/),
        expect.stringMatching(/^new_things: no index that leads with hub_id/),
      ]),
    );
  });

  it("fails each rule on its own", () => {
    const one = (patch: Partial<CatalogRow>) => catalogProblems([{ ...good("t"), ...patch }]);
    expect(one({ rls_forced: false })).toEqual(["t: row-level security is not FORCEd"]);
    expect(one({ hub_leading_index: false })).toEqual(["t: no index that leads with hub_id"]);
    expect(one({ policies: [] })).toHaveLength(1);
    expect(one({ policies: [{ ...policy, using: "true" }] })[0]).toMatch(/USING is true/);
    expect(one({ policies: [{ ...policy, cmd: "r" }] })[0]).toMatch(/not FOR ALL/);
    expect(one({ policies: [{ ...policy, roles: ["anon", "authenticated"] }] })[0]).toMatch(/applies to/);
    expect(one({ policies: [policy, { ...policy, name: "open_read", using: "true" }] })).toEqual([
      "t: extra policy open_read (only hub_isolation, from the template)",
    ]);
  });

  it("the registry must stay deny-all", () => {
    expect(catalogProblems([{ ...registry, policies: [policy] }])[0]).toMatch(/^hubs: not hub-scoped/);
    expect(catalogProblems([{ ...registry, rls_forced: false }])).toEqual(["hubs: row-level security is not FORCEd"]);
  });
});

describe("storagePolicyProblems", () => {
  const storage = (names: string[]): CatalogRow => ({
    table_name: "storage.objects",
    has_hub_id: false,
    rls_enabled: true,
    rls_forced: false,
    hub_leading_index: false,
    policies: names.map((name) => ({ ...policy, name, using: "(storage.foldername(name))[1] = current_hub_id()" })),
  });
  it("nothing to check without a storage schema", () => {
    expect(storagePolicyProblems([good("processes")])).toEqual([]);
  });
  it("wants all four post-images policies", () => {
    const all = ["post_images_hub_delete", "post_images_hub_insert", "post_images_hub_read", "post_images_hub_update"];
    expect(storagePolicyProblems([storage(all)])).toEqual([]);
    expect(storagePolicyProblems([storage(all.slice(1))])).toHaveLength(1);
  });
});
