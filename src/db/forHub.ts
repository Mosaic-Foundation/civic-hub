// forHub(hubId) — the hub-scoped data layer.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 3. Data layer".
//
// The only way request code reaches tenant data. It keeps the query-builder
// SHAPE the code already uses — `from(table).select/insert/upsert/update/
// delete`, then filters and modifiers — but not Supabase's result shape:
//
//   await …select(…)            rows (an array)
//   await ….maybeSingle()       one row, or null
//   await ….single()            one row (throws if there is not exactly one)
//   await …count()              a number
//   await …insert/upsert/update/delete(…)
//                               null, or rows when `.select()` is chained
//   any failure                 throws HubDbError, with the Postgres `code`
//
// Supabase's `{ data, error }` pair never leaves src/db/ (Adam, 2026-09-24),
// so a later change of driver is a change of this file, not of every caller.
//
// What it adds on top of the builder:
//
//   select / count / update / delete   `.eq("hub_id", hubId)`, applied when
//                                      the builder is created, so no chain
//                                      can leave it off
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

/** A row as the code reads it today: untyped columns, cast by the caller. */
export type Row = Record<string, any>;

/**
 * A database failure, thrown by every forHub() operation. `code` is the
 * Postgres SQLSTATE (e.g. "23505" for a unique violation) or PostgREST's own
 * code (e.g. "PGRST116" for `.single()` finding no row), so callers can branch
 * on a conflict without seeing the driver's result shape.
 */
export class HubDbError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  constructor(message: string, code?: string, details?: string) {
    super(message);
    this.name = "HubDbError";
    this.code = code;
    this.details = details;
  }
}

/** Filters and modifiers, shared by reads and writes. Each returns the query. */
export interface HubFilters<Q> {
  eq(column: string, value: unknown): Q;
  neq(column: string, value: unknown): Q;
  gt(column: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  like(column: string, pattern: string): Q;
  ilike(column: string, pattern: string): Q;
  is(column: string, value: null | boolean): Q;
  in(column: string, values: readonly unknown[]): Q;
  not(column: string, operator: string, value: unknown): Q;
  or(filters: string): Q;
  contains(column: string, value: unknown): Q;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Q;
  limit(count: number): Q;
  range(from: number, to: number): Q;
}

/** A read. Awaiting it gives the rows. */
export interface HubSelect<T> extends HubFilters<HubSelect<T>>, PromiseLike<T[]> {
  /** Exactly one row, or HubDbError (code "PGRST116" when there is none). */
  single(): PromiseLike<T>;
  /** One row, or null. */
  maybeSingle(): PromiseLike<T | null>;
}

/** A count. Awaiting it gives the number of matching rows in this hub. */
export interface HubCount extends HubFilters<HubCount>, PromiseLike<number> {}

/** A write. Awaiting it gives null; chain `.select()` to get the rows back. */
export interface HubWrite<T> extends HubFilters<HubWrite<T>>, PromiseLike<null> {
  select<U = T>(columns?: string): HubSelect<U>;
}

/** The builder surface of one hub-scoped table. */
export interface HubQueryBuilder {
  select<T = Row>(columns?: string): HubSelect<T>;
  count(): HubCount;
  insert<T = Row>(values: Row | Row[]): HubWrite<T>;
  upsert<T = Row>(
    values: Row | Row[],
    options: { onConflict: string; ignoreDuplicates?: boolean },
  ): HubWrite<T>;
  update<T = Row>(values: Row): HubWrite<T>;
  delete<T = Row>(): HubWrite<T>;
}

export type HubDb = {
  /** A hub-scoped table. `hubs` is not one: see src/db/hubs.ts. */
  from(table: TableName): HubQueryBuilder;
  /** A database function; the hub is passed as the named argument `p_hub_id`. */
  rpc<T = unknown>(fn: string, args?: Row): PromiseLike<T>;
  readonly hubId: string;
};

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

interface PostgrestResult {
  data: unknown;
  error: { message: string; code?: string; details?: string } | null;
  count?: number | null;
}

type Thenable = {
  url: URL;
  then: (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise<unknown>;
};

/**
 * Make an awaited builder resolve to rows (or a count) and throw HubDbError on
 * failure. The builder is a thenable whose filters and modifiers mutate it and
 * return `this`, so replacing `then` on the instance covers whatever the caller
 * chains before awaiting it.
 *
 * `guard` names an update or delete, which is refused at execution if its hub
 * filter is gone.
 */
function settle<B>(
  builder: B,
  hubId: string,
  table: string,
  mode: "data" | "count",
  guard?: "update" | "delete",
): B {
  const b = builder as unknown as Thenable;
  const send = b.then.bind(builder) as (
    ok: (r: PostgrestResult) => unknown,
  ) => Promise<unknown>;
  b.then = (ok, bad) => {
    if (guard && !b.url.searchParams.getAll("hub_id").includes(`eq.${hubId}`)) {
      return Promise.reject(
        new Error(
          `forHub("${hubId}").from("${table}").${guard}(): refusing to run without its hub filter.`,
        ),
      ).then(ok, bad);
    }
    return send((r) => {
      if (r.error) {
        throw new HubDbError(
          `${table}: ${r.error.message}`,
          r.error.code || undefined,
          r.error.details || undefined,
        );
      }
      return mode === "count" ? (r.count ?? 0) : (r.data ?? null);
    }).then(ok, bad);
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
  // The real builder is called through a loose signature: its generics are
  // deeper than the compiler will follow through a wrapper, and the public
  // types are this file's own.
    type Loose = any;
  const raw = (): Loose => client.from(table);
  const done = (q: Loose, guard?: "update" | "delete"): Loose =>
    settle(q, hubId, table, "data", guard);

  return {
    select: (columns?: string) => done(raw().select(columns ?? "*").eq("hub_id", hubId)),

    count: () =>
      settle(
        raw().select("*", { count: "exact", head: true }).eq("hub_id", hubId),
        hubId,
        table,
        "count",
      ),

    insert: (values: Row | Row[]) => done(raw().insert(stampAll(hubId, table, values))),

    upsert: (values: Row | Row[], options: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const target = (options?.onConflict ?? "").split(",").map((c) => c.trim());
      if (!target.includes("hub_id")) {
        throw new Error(
          `forHub("${hubId}").from("${table}").upsert(): onConflict must include hub_id ` +
            `(got "${options?.onConflict ?? "the primary key"}"). A conflict on a global ` +
            "key would update whichever hub's row it hit.",
        );
      }
      return done(raw().upsert(stampAll(hubId, table, values), options));
    },

    update: (values: Row) => {
      if (values && "hub_id" in values && values.hub_id !== undefined && values.hub_id !== hubId) {
        throw foreignHub(`an update of ${table}`, hubId, values.hub_id);
      }
      return done(raw().update(values).eq("hub_id", hubId), "update");
    },

    delete: () => done(raw().delete().eq("hub_id", hubId), "delete"),
  } as HubQueryBuilder;
}

/**
 * A hub-scoped client over an explicit Supabase client. forHub() is this over
 * the service-role client; tests pass a stub or a local-stack client.
 */
export function hubDbFrom(client: SupabaseClient, hubId: string): HubDb {
  if (typeof hubId !== "string" || !HUB_ID_SHAPE.test(hubId)) {
    throw new Error(`forHub: "${String(hubId)}" is not a hub id.`);
  }
  const rpc = <T = unknown>(fn: string, args: Row = {}): PromiseLike<T> => {
    if ("p_hub_id" in args && args.p_hub_id !== hubId) {
      throw foreignHub(`rpc ${fn}'s p_hub_id`, hubId, args.p_hub_id);
    }
    return (client.rpc(fn, { ...args, p_hub_id: hubId }) as unknown as PromiseLike<PostgrestResult>)
      .then((r) => {
        if (r.error) {
          throw new HubDbError(`rpc ${fn}: ${r.error.message}`, r.error.code || undefined, r.error.details || undefined);
        }
        return r.data as T;
      });
  };

  return {
    hubId,
    rpc,
    from: (table: TableName) => scopedTable(client, hubId, table),
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
