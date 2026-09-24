// forHub(hubId) — the hub-scoped data layer.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 3. Data layer".
//
// The only way request code reaches tenant data. It wraps the same
// query-builder surface the code already uses — `from(table).select/insert/
// upsert/update/delete`, then any filter or modifier — so converting a module
// is replacing `getDb()` with `forHub(hubId)` and nothing else. What it adds:
//
//   select / update / delete   `.eq("hub_id", hubId)`, applied when the builder
//                              is created, so no chain can leave it off
//   insert / upsert            `hub_id: hubId` stamped on every row
//   another hub's hub_id       in a payload, an update or an rpc argument, is
//                              an error — never an override
//   upsert                     its conflict target must name hub_id, because
//                              an upsert that conflicts on a global key
//                              UPDATES whichever hub's row it hits
//
// An update or delete is also checked when it runs: if its hub filter is not
// on the request, it throws instead of sending. Nothing in the builder API
// removes a filter; the check exists so that stays true under refactoring.
//
// Phase 2a runs this over the service-role client. Phase 3 swaps the client
// for one that authenticates as `authenticated` with a minted, hub-scoped JWT,
// so forced RLS becomes a second, independent filter. Callers do not change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "./client.js";

/**
 * Every table that carries hub_id — 30 of the 31. `hubs` is the registry,
 * read by src/db/hubs.ts, and is deliberately unreachable from here.
 */
export const HUB_TABLES = [
  "active_vote_keys",
  "brief_responses",
  "community_inputs",
  "deliberation_drafts",
  "deliberation_submissions",
  "deliberation_votes",
  "events",
  "feedback_submissions",
  "hub_settings",
  "link_previews",
  "pending_verifications",
  "process_links",
  "process_reviews",
  "processes",
  "project_comments",
  "project_drafts",
  "project_sentiments",
  "project_updates",
  "projects",
  "proposal_drafts",
  "proposal_supports",
  "proposals",
  "review_turns",
  "sessions",
  "users",
  "vote_drafts",
  "vote_participation",
  "vote_records",
  "waitlist",
  "wordcloud_submissions",
] as const;

export type TableName = (typeof HUB_TABLES)[number];

const TABLE_SET: ReadonlySet<string> = new Set(HUB_TABLES);

/** Same shape as `hubs.id`: see the slug check in 20260922010000_hubs.sql. */
const HUB_ID_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;

type RawQueryBuilder = ReturnType<SupabaseClient["from"]>;

/**
 * The builder surface of `SupabaseClient["from"]`, hub-scoped. The generic
 * names the table for the contract; row types stay as loose as the untyped
 * client the code uses today.
 */
export type HubQueryBuilder<T extends TableName = TableName> = Pick<
  RawQueryBuilder,
  "select" | "insert" | "upsert" | "update" | "delete"
>;

export type HubDb = {
  /** Same builder surface as SupabaseClient["from"], hub-scoped. */
  from<T extends TableName>(table: T): HubQueryBuilder<T>;
  /** For .rpc() calls; hub_id is passed as the named argument `p_hub_id`. */
  rpc: SupabaseClient["rpc"];
  readonly hubId: string;
};

type Row = Record<string, unknown>;

function foreignHub(where: string, hubId: string, found: unknown): Error {
  return new Error(
    `forHub("${hubId}"): ${where} names hub_id "${String(found)}". A hub-scoped ` +
      "client writes only its own hub; the hub comes from forHub(), never the payload.",
  );
}

function stamp(hubId: string, table: string, row: Row): Row {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`forHub("${hubId}").from("${table}"): each row must be an object`);
  }
  if ("hub_id" in row && row.hub_id !== undefined && row.hub_id !== hubId) {
    throw foreignHub(`a row for ${table}`, hubId, row.hub_id);
  }
  return { ...row, hub_id: hubId };
}

function stampAll(hubId: string, table: string, values: Row | Row[]): Row | Row[] {
  return Array.isArray(values)
    ? values.map((r) => stamp(hubId, table, r))
    : stamp(hubId, table, values);
}

/**
 * Refuse to run an update or delete whose hub filter is gone. The builder is
 * a thenable whose filters mutate `url` in place and return `this`, so the
 * object the caller finally awaits is the one checked here.
 */
function guardExecution<B>(builder: B, hubId: string, table: string, op: string): B {
  const b = builder as unknown as {
    url: URL;
    then: (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise<unknown>;
  };
  const send = b.then.bind(builder);
  b.then = (ok, bad) => {
    if (!b.url.searchParams.getAll("hub_id").includes(`eq.${hubId}`)) {
      return Promise.reject(
        new Error(
          `forHub("${hubId}").from("${table}").${op}(): refusing to run without its hub filter.`,
        ),
      ).then(ok, bad);
    }
    return send(ok, bad);
  };
  return builder;
}

function scopedTable(client: SupabaseClient, hubId: string, table: string): HubQueryBuilder {
  if (!TABLE_SET.has(table)) {
    throw new Error(
      `forHub("${hubId}").from("${table}"): not a hub-scoped table. ` +
        "The registry (hubs) is read through src/db/hubs.ts.",
    );
  }
  // The wrappers call the real builder through a loose signature: its
  // generics are deeper than the compiler will follow through a wrapper, and
  // the public type (HubQueryBuilder) is the builder's own.
  type Loose = any;
  const raw = (): Loose => client.from(table);

  const select = (columns?: string, options?: object): Loose =>
    raw().select(columns, options).eq("hub_id", hubId);

  const insert = (values: Row | Row[], options?: object): Loose =>
    raw().insert(stampAll(hubId, table, values), options);

  const upsert = (values: Row | Row[], options?: { onConflict?: string }): Loose => {
    const target = (options?.onConflict ?? "").split(",").map((c) => c.trim());
    if (!target.includes("hub_id")) {
      throw new Error(
        `forHub("${hubId}").from("${table}").upsert(): onConflict must include hub_id ` +
          `(got "${options?.onConflict ?? "the primary key"}"). A conflict on a global ` +
          "key would update whichever hub's row it hit.",
      );
    }
    return raw().upsert(stampAll(hubId, table, values), options);
  };

  const update = (values: Row, options?: object): Loose => {
    if (values && "hub_id" in values && values.hub_id !== undefined && values.hub_id !== hubId) {
      throw foreignHub(`an update of ${table}`, hubId, values.hub_id);
    }
    return guardExecution(raw().update(values, options).eq("hub_id", hubId), hubId, table, "update");
  };

  const del = (options?: object): Loose =>
    guardExecution(raw().delete(options).eq("hub_id", hubId), hubId, table, "delete");

  return { select, insert, upsert, update, delete: del } as HubQueryBuilder;
}

/**
 * A hub-scoped client over an explicit Supabase client. forHub() is this over
 * the service-role client; tests pass a stub or a local-stack client.
 */
export function hubDbFrom(client: SupabaseClient, hubId: string): HubDb {
  if (typeof hubId !== "string" || !HUB_ID_SHAPE.test(hubId)) {
    throw new Error(`forHub: "${String(hubId)}" is not a hub id.`);
  }
  const rpc = ((fn: string, args: Row = {}, options?: object) => {
    if ("p_hub_id" in args && args.p_hub_id !== hubId) {
      throw foreignHub(`rpc ${fn}'s p_hub_id`, hubId, args.p_hub_id);
    }
    return (client.rpc as (f: string, a: Row, o?: object) => unknown)(
      fn,
      { ...args, p_hub_id: hubId },
      options,
    );
  }) as unknown as SupabaseClient["rpc"];

  return {
    hubId,
    rpc,
    from: <T extends TableName>(table: T) => scopedTable(client, hubId, table) as HubQueryBuilder<T>,
  };
}

const cache = new Map<string, HubDb>();

/** The hub-scoped client for one hub. The way request code reaches the database. */
export function forHub(hubId: string): HubDb {
  let db = cache.get(hubId);
  if (!db) {
    db = hubDbFrom(getDb(), hubId);
    cache.set(hubId, db);
  }
  return db;
}
