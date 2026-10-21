// How the conformance suite drives a process type on a running hub, with no
// type-specific code: everything type-specific comes from the type's
// descriptor (src/processes/descriptor.ts): its draft path and example, its
// create example, its actions with their example inputs, its deadline source.
//
// Talks to the hub over HTTP (tests/fixtures/hostCall.ts) as residents and
// admins with minted sessions, and reads and writes the local stack directly
// (PostgREST as the service role, and Postgres for a trigger) only where a
// test must see or set what no route shows: the events a process wrote, a
// draft's check result, a deadline moved into the past. LOCAL STACK ONLY.

import { randomUUID } from "node:crypto";
import pg from "pg";
import { call, type HostResponse } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { COC_DOWN, COC_FLAG } from "../fixtures/codeOfConduct.js";
import type { ProcessTypeDescriptor } from "../../src/processes/descriptor.js";
import type { HostFacts } from "../../src/processes/descriptorCheck.js";
import type { EventRow } from "../../src/events/eventStore.js";
import type { Hub as HubModel } from "../../src/models/hub.js";

export const DB_URL =
  process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`conformance: refusing ${host}; local stack only.`);
}

/** A hub the suite works on: its id, the hostname that reaches it, its admin. */
export interface Hub {
  slug: string;
  host: string;
  adminEmail: string;
}

/** The local seed's two hubs: Floyd is a beta hub (an admin reviews), Athens a demo (no review). */
export const BETA: Hub = { slug: "floyd", host: "floyd.civic.social", adminEmail: "admin@example.test" };
export const DEMO: Hub = { slug: "athens", host: "athens.localhost", adminEmail: "admin+athens@example.test" };

const run = Date.now().toString(36);
let people = 0;

/** A new resident on `hub`, signed in. */
export async function resident(hub: Hub): Promise<{ token: string; email: string }> {
  const email = `conformance-${run}-${++people}@example.test`;
  return { token: await mintSession(hub.slug, email), email };
}

const admins = new Map<string, string>();
export async function admin(hub: Hub): Promise<string> {
  if (!admins.has(hub.slug)) admins.set(hub.slug, await mintSession(hub.slug, hub.adminEmail));
  return admins.get(hub.slug)!;
}

/** A title no other run shares, so a test's rows are its own. */
export function uniqueTitle(base: string): string {
  return `${base} ${run}-${randomUUID().slice(0, 6)}`;
}

/** The example with its title (and topic) made unique. */
function withTitle(example: Record<string, unknown>, title: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...example, title };
  if (typeof example.topic === "string") out.topic = title;
  return out;
}

export interface Submitted {
  status: number;
  body: Record<string, unknown>;
  processId: string;
  reviewId: string;
  draftId: string;
  title: string;
}

/**
 * The fake Code of Conduct check's markers (the hub runs CIVIC_COC_FAKE=on;
 * src/debug/fakeCodeOfConduct.ts): flagged, or the check down.
 */
const MARKER = { passed: "", flagged: COC_FLAG, unavailable: COC_DOWN } as const;

/**
 * A resident's draft of this type, submitted the way a resident submits it:
 * the draft is made at the descriptor's drafts path, filled from its example,
 * and Submit runs the Code of Conduct check on it (Submit and Save,
 * 2026-10-12). `check` picks what the check finds, by a marker the fake check
 * answers to in the draft's description: nothing, something to fix, or that
 * it can't run. `tellAdmins` sends flagged text to the admins.
 */
export async function submitDraft(
  d: ProcessTypeDescriptor,
  host: HostFacts,
  hub: Hub,
  token: string,
  opts: {
    check: "passed" | "flagged" | "unavailable";
    title?: string;
    fields?: Record<string, unknown>;
    tellAdmins?: { note?: string };
  },
): Promise<Submitted> {
  const path = d.creation.resident!.drafts;
  const title = opts.title ?? uniqueTitle(String(d.examples.draft!.title ?? d.type));
  const made = await call("POST", path, hub.host, {}, token);
  if (made.status !== 201) throw new Error(`${d.type}: new draft at ${path} answered ${made.status} ${JSON.stringify(made.body)}`);
  const draftId = made.body.id as string;
  const fields = { ...withTitle(d.examples.draft!, title), ...opts.fields };
  // The marker goes on last, so a caller's own description keeps it.
  const description = `${String(fields.description ?? "")} ${MARKER[opts.check]}`.trim();
  const filled = await call("PATCH", `${path}/${draftId}`, hub.host, { ...fields, description }, token);
  if (filled.status !== 200) throw new Error(`${d.type}: filling the draft answered ${filled.status} ${JSON.stringify(filled.body)}`);
  const body = opts.tellAdmins ? { tell_admins: true, ...(opts.tellAdmins.note ? { note: opts.tellAdmins.note } : {}) } : {};
  const res = await call("POST", `${path}/${draftId}/submit`, hub.host, body, token);
  return {
    status: res.status,
    body: res.body,
    processId: res.body.process_id as string,
    reviewId: res.body.review_id as string,
    draftId,
    title,
  };
}

/** Submit a draft again, sending what the check flagged to the admins. */
export function tellAdmins(
  d: ProcessTypeDescriptor,
  hub: Hub,
  token: string,
  draftId: string,
  note?: string,
): Promise<HostResponse> {
  return call("POST", `${d.creation.resident!.drafts}/${draftId}/submit`, hub.host, { tell_admins: true, ...(note ? { note } : {}) }, token);
}

/** A draft as its owner reads it. */
export function draftOf(d: ProcessTypeDescriptor, hub: Hub, token: string, draftId: string): Promise<HostResponse> {
  return call("GET", `${d.creation.resident!.drafts}/${draftId}`, hub.host, undefined, token);
}

/** The reviews made from a draft, with their flag and their first turn's note. */
export async function reviewsOfDraft(
  draftId: string,
): Promise<{ id: string; status: string; process_id: string; coc_flags: unknown[] | null; note: string | null }[]> {
  const reviews = (await localRest(
    `process_reviews?select=id,status,process_id,coc_flags&draft_id=eq.${draftId}`,
  )) as { id: string; status: string; process_id: string; coc_flags: unknown[] | null }[];
  return Promise.all(
    reviews.map(async (r) => {
      const turns = (await localRest(`review_turns?select=note&review_id=eq.${r.id}&turn_number=eq.1`)) as { note: string | null }[];
      return { ...r, note: turns[0]?.note ?? null };
    }),
  );
}

/** Approve a review as the hub's admin. */
export function approve(hub: Hub, adminToken: string, reviewId: string): Promise<HostResponse> {
  return call("POST", `/admin/reviews/${reviewId}/approve`, hub.host, {}, adminToken);
}

/** An admin creates one directly, from the descriptor's create example. */
export async function adminCreate(d: ProcessTypeDescriptor, hub: Hub): Promise<{ processId: string; res: HostResponse }> {
  const { path = "/process", body } = d.examples.create!;
  const res = await call("POST", path, hub.host, withTitle(body, uniqueTitle(String(body.title ?? d.type))), await admin(hub));
  const b = res.body as Record<string, unknown>;
  const processId = (b.process_id ?? b.id ?? (b.process as { id?: string } | undefined)?.id) as string;
  return { processId, res };
}

/**
 * A live process of this type on `hub`, made the way its descriptor says one
 * is made: a resident's draft approved by an admin, or an admin's create.
 */
export async function liveProcess(d: ProcessTypeDescriptor, host: HostFacts, hub: Hub): Promise<string> {
  if (d.creation.resident) {
    const { token } = await resident(hub);
    const s = await submitDraft(d, host, hub, token, { check: "unavailable" });
    if (s.status !== 201) throw new Error(`${d.type}: submit answered ${s.status} ${JSON.stringify(s.body)}`);
    const ok = await approve(hub, await admin(hub), s.reviewId);
    if (ok.status !== 200) throw new Error(`${d.type}: approval answered ${ok.status} ${JSON.stringify(ok.body)}`);
    return s.processId;
  }
  const { processId, res } = await adminCreate(d, hub);
  if (res.status >= 300 || !processId) throw new Error(`${d.type}: create answered ${res.status} ${JSON.stringify(res.body)}`);
  return processId;
}

// --- Reading what happened ----------------------------------------------------

export interface ProcessRowView {
  id: string;
  type: string;
  status: string;
  created_by: string | null;
  state: Record<string, unknown>;
  hub_id: string;
}

export async function processRow(id: string): Promise<ProcessRowView> {
  const rows = (await localRest(`processes?select=id,type,status,created_by,state,hub_id&id=eq.${id}`)) as ProcessRowView[];
  if (!rows[0]) throw new Error(`no process ${id}`);
  return rows[0];
}

export interface EventRowView {
  id: string;
  event_type: string;
  process_id: string;
  hub_id: string;
  created_at: string;
}

/** A process's event rows whole (wire columns included), oldest first, as the store reads them. */
export async function eventRowsOf(processId: string): Promise<EventRow[]> {
  return (await localRest(
    `events?select=*&process_id=eq.${processId}&order=created_at.asc,id.asc`,
  )) as EventRow[];
}

/** A hub's registry row, as the resolver puts it in scope. */
export async function hubRow(slug: string): Promise<HubModel> {
  const rows = (await localRest(`hubs?select=*&id=eq.${slug}`)) as HubModel[];
  if (!rows[0]) throw new Error(`no hub ${slug}`);
  return rows[0];
}

/** Every event a process has, oldest first, restricted ones included. */
export async function eventsOf(processId: string): Promise<EventRowView[]> {
  return (await localRest(
    `events?select=id,event_type,process_id,hub_id,created_at&process_id=eq.${processId}&order=created_at.asc,id.asc`,
  )) as EventRowView[];
}

export async function reviewOf(processId: string): Promise<{ id: string; status: string }[]> {
  return (await localRest(`process_reviews?select=id,status&process_id=eq.${processId}`)) as { id: string; status: string }[];
}

/** The briefs a process produced (spawnBrief keys them by source). */
export async function briefsOf(processId: string): Promise<{ id: string }[]> {
  return (await localRest(
    `processes?select=id&type=eq.civic.brief&state->>source_process_id=eq.${processId}`,
  )) as { id: string }[];
}

// --- Acting -------------------------------------------------------------------

/** One action through POST /process/:id/action. */
export function act(hub: Hub, id: string, type: string, payload: Record<string, unknown>, token: string): Promise<HostResponse> {
  return call("POST", `/process/${id}/action`, hub.host, { type, payload }, token);
}

/**
 * The example payload of an action, with any value the process itself must
 * supply (a word cloud's prompt id) filled from its state.
 */
export function examplePayload(
  d: ProcessTypeDescriptor,
  actionName: string,
  row: ProcessRowView,
): Record<string, unknown> {
  const action = d.actions.find((a) => a.name === actionName)!;
  const example = (action.input_schema?.examples as Record<string, unknown>[] | undefined)?.[0] ?? {};
  const out = { ...example };
  const prompts = row.state.prompts as Array<{ id: string }> | undefined;
  if ("prompt_id" in out && prompts?.[0]) out.prompt_id = prompts[0].id;
  const options = row.state.options as string[] | undefined;
  if (typeof out.option === "string" && options && !options.includes(out.option as string)) out.option = options[0];
  return out;
}

// --- Setting what no route sets -----------------------------------------------

/**
 * Move a process's deadline into the past, wherever its descriptor says the
 * deadline lives: "state.<path>" on the process row, or "<table>.<column>" on
 * a row keyed by the process id.
 */
export async function expireDeadline(d: ProcessTypeDescriptor, id: string): Promise<string> {
  const past = new Date(Date.now() - 60_000).toISOString();
  const source = d.deadline!.source;
  if (source.startsWith("state.")) {
    const key = source.slice("state.".length);
    const row = await processRow(id);
    await localRest(`processes?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...row.state, [key]: past } }),
    });
  } else {
    const [table, column] = source.split(".");
    await localRest(`${table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ [column]: past }) });
  }
  return past;
}

/**
 * Titles starting with this fail to leave pending_review while the trap is
 * installed (installApprovalTrap), as a database behind its code would
 * (Audit 3's dev incident). Rename a process to let its approval through.
 */
export const FAILS_ON_APPROVAL = `Fails on approval ${run}`;

let trap: { db: pg.Client; fn: string } | null = null;

/** PostgREST reloads its schema on any DDL and drops connections in flight: let it settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1_500));
}

/**
 * Install the trigger behind FAILS_ON_APPROVAL, once per run (a trigger made
 * and dropped per test would reload PostgREST's schema mid-suite, and a
 * request in flight then gets a 502 from the gateway).
 */
export async function installApprovalTrap(): Promise<void> {
  if (trap) return;
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const fn = `conformance_fail_${run}`;
  await db.query(`
    CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.title LIKE '${FAILS_ON_APPROVAL}%' AND OLD.status = 'pending_review'
         AND NEW.status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'forced approval failure (conformance)';
      END IF;
      RETURN NEW;
    END $$`);
  await db.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON public.processes FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
  trap = { db, fn };
  await settle();
}

export async function removeApprovalTrap(): Promise<void> {
  if (!trap) return;
  const { db, fn } = trap;
  trap = null;
  await db.query(`DROP TRIGGER IF EXISTS ${fn} ON public.processes`).catch(() => {});
  await db.query(`DROP FUNCTION IF EXISTS public.${fn}()`).catch(() => {});
  await db.end();
  await settle();
}

/** Rename a trapped process so its next approval goes through. */
export async function releaseFromTrap(id: string): Promise<void> {
  const row = (await localRest(`processes?select=title&id=eq.${id}`)) as Array<{ title: string }>;
  await localRest(`processes?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: row[0].title.replace(FAILS_ON_APPROVAL, "Approved after a failure") }),
  });
}

/** Switch a plugin on or off on a hub, as its admin does. */
export async function setPlugin(hub: Hub, plugin: string, on: boolean): Promise<void> {
  const res = await call(
    "PUT",
    "/admin/hub/settings",
    hub.host,
    { section: "plugins", values: { [`plugin.${plugin}.enabled`]: on ? "true" : "false" } },
    await admin(hub),
  );
  if (res.status !== 200) throw new Error(`switching plugin ${plugin} answered ${res.status} ${JSON.stringify(res.body)}`);
}

/** The in-memory Polis (CIVIC_POLIS_FAKE=on): its mode and the calls it saw. */
export async function fakePolis(
  hub: Hub,
  change?: { mode?: "up" | "down" | "slow" | "error"; slow_ms?: number; clear_calls?: boolean },
): Promise<{ status: number; mode: string; calls: Array<{ path: string; xid: string | null; credential: string; outcome: string }> }> {
  const res = change
    ? await call("PUT", "/debug/polis-fake", hub.host, change, await admin(hub))
    : await call("GET", "/debug/polis-fake", hub.host, undefined, await admin(hub));
  return { status: res.status, ...(res.body as { mode: string; calls: [] }) };
}
