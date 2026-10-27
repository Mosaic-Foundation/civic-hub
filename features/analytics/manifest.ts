// The Activity feature's manifest (ADR-016; src/processes/manifest.ts's
// FeatureManifest). Plain data: the host reads its tables and jobs without
// loading its code.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const ANALYTICS_MANIFEST = defineFeatureManifest({
  feature: "analytics",
  tables: [
    {
      name: "analytics_daily",
      rows: "omit",
      reason: "derived from the events, which the export carries; the next host's job recomputes it",
      key: ["hub_id", "day", "process_type", "event_type"],
      holds: "how many events of each kind happened each day",
    },
    {
      name: "analytics_period",
      rows: "omit",
      reason: "derived from the events and accounts, which the export carries; the next host's job recomputes it",
      key: ["hub_id", "period_kind", "period_start", "measure"],
      holds: "how many residents took part in each week, month and quarter",
    },
    {
      name: "analytics_report_keys",
      rows: "export",
      key: ["hub_id", "id"],
      holds: "the reporting keys the hub's admins issued to outside organisations (a fingerprint of each, never the key)",
    },
    {
      name: "analytics_report_reads",
      rows: "export",
      key: ["hub_id", "id"],
      holds: "each read an outside organisation made with its key",
    },
  ],
  requiredSchema: [
    { table: "analytics_daily", columns: ["hub_id", "day", "process_type", "event_type", "events"], owner: "features/analytics" },
    {
      table: "analytics_period",
      columns: ["hub_id", "period_kind", "period_start", "period_end", "measure", "value", "computed_at"],
      owner: "features/analytics",
    },
    {
      table: "analytics_report_keys",
      columns: ["hub_id", "id", "organisation", "contact", "purpose", "key_hash", "key_hint", "created_at", "revoked_at"],
      owner: "features/analytics",
    },
    {
      table: "analytics_report_reads",
      columns: ["hub_id", "id", "key_id", "organisation", "read_at", "period_kind", "period_start"],
      owner: "features/analytics",
    },
  ],
  jobs: [
    {
      id: "analytics",
      plugin: "analytics",
      path: "/analytics/run",
      // Hourly, so the current week reads at most an hour behind.
      schedule: "40 * * * *",
      description: "Activity counts from the event log: the day's events and each period's residents, per hub",
    },
  ],
});
