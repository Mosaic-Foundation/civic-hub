// The rules every table in `public` must meet under Phase 3's forced RLS, as
// one pure function over the rows of `tenancy_catalog()`
// (20260925010000). tests/api/rlsCatalog.test.ts runs it on the real schema;
// tests/unit/tenancyCatalog.test.ts proves it fails on a table added without
// hub_id, without the policy, or without a hub-leading index.

export interface CatalogPolicy {
  name: string;
  /** pg_policy.polcmd: "*" all, "r" select, "a" insert, "w" update, "d" delete. */
  cmd: string;
  permissive: boolean;
  roles: string[] | null;
  using: string | null;
  with_check: string | null;
}

export interface CatalogRow {
  table_name: string;
  has_hub_id: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  hub_leading_index: boolean;
  policies: CatalogPolicy[];
}

/**
 * Tables that do not carry hub_id, and why. Nothing else may be here without
 * a reason Adam agreed to.
 */
export const NOT_HUB_SCOPED: Readonly<Record<string, string>> = {
  hubs: "the registry itself (contract 1); read by the service-role resolver only, deny-all RLS, no policy",
  // The super admin's own records (20260926010000, Phase 5 part one, Adam
  // 2026-09-26). Platform data, not any hub's: read and written only by
  // src/control/ as the service role; deny-all RLS, no policy, and no grants
  // to anon or authenticated.
  control_codes: "the super admin's emailed sign-in / step-up codes; platform, not hub, data; service role (src/control/) only",
  control_sessions: "the super admin's sessions; platform, not hub, data; service role (src/control/) only",
  control_audit_log:
    "every super admin action, across hubs; a hub must not read another's rows or its own audit trail's platform view; append-only, service role (src/control/) only",
  // Invite codes and the start page (20261008010000, session 4b, Adam
  // 2026-10-08). Platform data: a right to create a hub belongs to a person
  // before any hub exists. Deny-all RLS, no policy; src/control/ only.
  entitlements:
    "rights granted on the platform (an invite code to create one hub; a payment later); hashed codes; no hub exists yet; service role (src/control/) only",
  entitlement_redemptions:
    "each use of an entitlement (who, which hub), across hubs; service role (src/control/) only",
  start_codes: "the start page's emailed sign-in codes, hashed; platform, not hub, data; service role (src/control/) only",
  start_sessions: "start-page sessions, by token hash; platform, not hub, data; service role (src/control/) only",
  start_attempts: "the start page's rate-limit counters (hashed IPs and emails); platform data; service role (src/control/) only",
  // Reference data (20260927000000, Adam 2026-09-27): the same list of US
  // jurisdictions for every hub. Deny-all RLS, no policy; the service role
  // (the console) may only SELECT; the loader writes as the owner.
  jurisdictions:
    "platform reference data (OCD division ids), the same for every hub; read-only: service role SELECT only, written by scripts/load-jurisdictions.ts as the owner",
};

/** The one expression the template writes, as Postgres prints it back. */
export const HUB_POLICY_EXPR = "(hub_id = ( SELECT current_hub_id() AS current_hub_id))";

/** Every way a catalog breaks the Phase 3 rules; empty when it meets them. */
export function catalogProblems(rows: readonly CatalogRow[]): string[] {
  const problems: string[] = [];
  const tables = rows.filter((r) => r.table_name !== "storage.objects");

  for (const t of tables) {
    const name = t.table_name;
    if (!t.rls_enabled) problems.push(`${name}: row-level security is not enabled`);
    if (!t.rls_forced) problems.push(`${name}: row-level security is not FORCEd`);

    if (name in NOT_HUB_SCOPED) {
      if (t.policies.length) problems.push(`${name}: not hub-scoped, so it must have no policy (deny-all); has ${t.policies.map((p) => p.name).join(", ")}`);
      continue;
    }

    if (!t.has_hub_id) {
      problems.push(`${name}: no hub_id column (every table carries one; see NOT_HUB_SCOPED for the exceptions)`);
    }
    if (!t.hub_leading_index) problems.push(`${name}: no index that leads with hub_id`);

    const hub = t.policies.filter((p) => p.name === "hub_isolation");
    const others = t.policies.filter((p) => p.name !== "hub_isolation");
    if (hub.length !== 1) {
      problems.push(`${name}: no hub_isolation policy — call _civic_apply_hub_policy('${name}') in its migration`);
    } else {
      const p = hub[0];
      if (p.cmd !== "*") problems.push(`${name}: hub_isolation is not FOR ALL (cmd ${p.cmd})`);
      if (!p.permissive) problems.push(`${name}: hub_isolation is not permissive`);
      if (JSON.stringify(p.roles) !== JSON.stringify(["authenticated"])) {
        problems.push(`${name}: hub_isolation applies to ${JSON.stringify(p.roles)}, not authenticated`);
      }
      if (p.using !== HUB_POLICY_EXPR) problems.push(`${name}: hub_isolation USING is ${p.using}, not the template's`);
      if (p.with_check !== HUB_POLICY_EXPR) problems.push(`${name}: hub_isolation WITH CHECK is ${p.with_check}, not the template's`);
    }
    // Any other permissive policy is OR-ed with hub_isolation and could open
    // the table wider than one hub, so none may exist.
    for (const p of others) problems.push(`${name}: extra policy ${p.name} (only hub_isolation, from the template)`);
  }
  return problems;
}

/** The storage policies from 20260924070000, where a storage schema exists. */
export function storagePolicyProblems(rows: readonly CatalogRow[]): string[] {
  const storage = rows.find((r) => r.table_name === "storage.objects");
  if (!storage) return []; // no storage schema here (plain Postgres, or storage off)
  const names = storage.policies.map((p) => p.name).sort();
  const expected = ["post_images_hub_delete", "post_images_hub_insert", "post_images_hub_read", "post_images_hub_update"];
  const problems: string[] = [];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    problems.push(`storage.objects: post-images policies are ${JSON.stringify(names)}, expected ${JSON.stringify(expected)}`);
  }
  for (const p of storage.policies) {
    const text = `${p.using ?? ""} ${p.with_check ?? ""}`;
    if (!text.includes("current_hub_id()")) problems.push(`storage.objects: ${p.name} does not key on current_hub_id()`);
  }
  return problems;
}
