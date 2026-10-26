// An in-memory Polis, for development and the conformance suite only
// (CIVIC_POLIS_FAKE=on, refused in production: src/config/devFlags.ts).
//
// It stands where Polis's HTTP API would, behind the hub's REAL adapter
// (packages/civic.polis_deliberation/adapter/polisAdapter.ts), which is handed
// fakePolisFetch in place of the network. So the adapter's own request
// building, auth header, timeout, retry and error handling all run: the
// conformance suite tests the hub's side of the Tier 3 contract (plugin
// architecture §10a) through the one adapter, as the spec asks, without
// calling out (CLAUDE.md: no external network calls).
//
// It can be told to be down (the request fails as an unreachable host
// would), slow (it answers after a delay, longer than the adapter's timeout
// in fake mode), or erroring (500), and it records what the hub sent it:
// which path, which participant identifier, and a fingerprint of the
// credential, so the suite can see whether participants cross the boundary
// one by one or behind one shared token (§10a.1).
//
// It is not a model of Polis's maths: the "math" endpoint reports
// participants and statements and one consensus statement per voted one.

import { createHash } from "node:crypto";

export const FAKE_POLIS_BASE_URL = "https://polis.fake.invalid";
/** What the adapter is given in fake mode: short, so outages test quickly. */
export const FAKE_POLIS_TIMEOUT_MS = 800;
export const FAKE_POLIS_RETRY_DELAYS_MS = [20, 20, 20] as const;

export type FakePolisMode = "up" | "down" | "slow" | "error";

/** One request the hub made, as the fake saw it. */
export interface FakePolisCall {
  method: string;
  /** The path without its query string. */
  path: string;
  /** The participant identifier (`xid`) the request carried, if any. */
  xid: string | null;
  /** A short fingerprint of the Authorization header ("" when none). */
  credential: string;
  /** What the fake did: answered, or simulated an outage. */
  outcome: "answered" | "down" | "error" | "timed_out";
}

interface Comment {
  tid: number;
  txt: string;
  xid: string | null;
  is_seed: boolean;
  created: string;
}

interface Conversation {
  zid: number;
  topic: string;
  closed: boolean;
  comments: Comment[];
  /** xid → (tid → vote) */
  votes: Map<string, Map<number, number>>;
}

const conversations = new Map<string, Conversation>();
let calls: FakePolisCall[] = [];
let mode: FakePolisMode = "up";
let slowMs = 2_000;
let nextId = 1;

export function setFakePolisMode(next: FakePolisMode, opts: { slowMs?: number } = {}): void {
  mode = next;
  if (opts.slowMs !== undefined) slowMs = opts.slowMs;
}

export function fakePolisState(): { mode: FakePolisMode; slow_ms: number; calls: FakePolisCall[] } {
  return { mode, slow_ms: slowMs, calls: [...calls] };
}

/** Forget recorded calls (conversations stay, so live ones keep working). */
export function clearFakePolisCalls(): void {
  calls = [];
}

function fingerprint(header: string | undefined): string {
  if (!header) return "";
  return createHash("sha256").update(header).digest("hex").slice(0, 12);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function waitOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

/** The fetch the adapter is given in fake mode. */
export async function fakePolisFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<Response> {
  const parsed = new URL(url);
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const xid =
    (typeof body.xid === "string" && body.xid) || parsed.searchParams.get("xid") || null;
  const call: FakePolisCall = {
    method,
    path: parsed.pathname,
    xid,
    credential: fingerprint(init.headers?.Authorization),
    outcome: "answered",
  };
  calls.push(call);

  if (mode === "down") {
    call.outcome = "down";
    throw new TypeError("fetch failed (fake Polis is down)");
  }
  if (mode === "error") {
    call.outcome = "error";
    return json(500, { error: "polis_err_fake_outage" });
  }
  if (mode === "slow") {
    try {
      await waitOrAbort(slowMs, init.signal);
    } catch (err) {
      call.outcome = "timed_out";
      throw err;
    }
  }
  return answer(method, parsed, body);
}

function answer(method: string, url: URL, body: Record<string, unknown>): Response {
  const path = url.pathname;
  const conversationId = String(body.conversation_id ?? url.searchParams.get("conversation_id") ?? "");
  const conv = conversations.get(conversationId);

  if (method === "POST" && path === "/api/v3/conversations") {
    const id = `fake${nextId++}`;
    conversations.set(id, { zid: nextId, topic: String(body.topic ?? ""), closed: false, comments: [], votes: new Map() });
    return json(200, { url: `${FAKE_POLIS_BASE_URL}/${id}`, zid: nextId });
  }
  if (!conv) return json(404, { error: "polis_err_no_conversation" });

  if (method === "POST" && path === "/api/v3/comments") {
    const txt = String(body.txt ?? "");
    if (conv.comments.some((c) => c.txt === txt)) return json(409, { error: "polis_err_post_comment_duplicate" });
    const tid = conv.comments.length;
    conv.comments.push({
      tid,
      txt,
      xid: typeof body.xid === "string" ? body.xid : null,
      is_seed: body.is_seed === true,
      created: new Date().toISOString(),
    });
    return json(200, { tid });
  }
  if (method === "GET" && path === "/api/v3/comments") {
    return json(200, conv.comments.map((c) => ({ tid: c.tid, txt: c.txt, pid: 0, created: c.created, mod: 1, is_seed: c.is_seed })));
  }
  if (method === "POST" && path === "/api/v3/votes") {
    if (conv.closed) return json(403, { error: "polis_err_conversation_closed" });
    const voter = String(body.xid ?? "");
    const mine = conv.votes.get(voter) ?? new Map<number, number>();
    mine.set(Number(body.tid), Number(body.vote));
    conv.votes.set(voter, mine);
    return json(200, {});
  }
  if (method === "GET" && path === "/api/v3/nextComment") {
    const voted = conv.votes.get(url.searchParams.get("xid") ?? "") ?? new Map();
    const next = conv.comments.find((c) => !voted.has(c.tid));
    return json(200, next ? { tid: next.tid, txt: next.txt, created: next.created, is_seed: next.is_seed } : {});
  }
  if (method === "GET" && path === "/api/v3/math/pca2") {
    const participants = new Set([...conv.votes.keys(), ...conv.comments.map((c) => c.xid).filter(Boolean)]);
    const agree = conv.comments
      .map((c) => {
        const all = [...conv.votes.values()].map((v) => v.get(c.tid)).filter((v) => v !== undefined);
        return { tid: c.tid, "n-success": all.filter((v) => v === 1).length, "n-trials": all.length };
      })
      .filter((c) => c["n-trials"] > 0)
      .map((c) => ({ ...c, "p-success": c["n-success"] / c["n-trials"] }));
    return json(200, {
      n: participants.size,
      "n-cmts": conv.comments.length,
      math_tick: conv.comments.length + participants.size,
      "group-clusters": [],
      "group-votes": {},
      repness: {},
      consensus: { agree, disagree: [] },
    });
  }
  if (method === "POST" && path === "/api/v3/conversation/close") {
    conv.closed = true;
    return json(200, {});
  }
  return json(404, { error: "polis_err_fake_unknown_endpoint" });
}
