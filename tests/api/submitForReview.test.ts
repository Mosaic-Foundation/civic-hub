// A submission is one transaction (submit_for_review, 20261024000000;
// Architecture 5, ADR-012): the process, its links, the review, the process's
// link back to it, the first turn and the `civic.review.submitted` event are
// written together or not at all. Links stay best-effort: a missing target or
// a repeat is skipped and counted, never fatal.
//
// The function is called the way forHub().rpc() calls it (PostgREST, service
// role, p_hub_id named). The forced failures are real failures part-way
// through: the event is the last write, so an event whose id already exists
// fails AFTER the process, review and turn were written inside the
// transaction, and the test checks none of them survived.
//
// Needs the local stack seeded as in CI.

import { beforeAll, describe, expect, it } from "vitest";
import { localRest } from "../fixtures/adminSession.js";

type Rows = Array<Record<string, unknown>>;
const rows = async (path: string) => (await localRest(path)) as Rows;
const run = Date.now().toString(36);

async function rpc(args: Record<string, unknown>): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  try {
    return { ok: true, body: await localRest("rpc/submit_for_review", { method: "POST", body: JSON.stringify(args) }) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function submission(n: string, overrides: { links?: unknown[]; eventId?: string; hub?: string } = {}) {
  const processId = `proc_sfr_${run}_${n}`;
  const reviewId = `rev_sfr_${run}_${n}`;
  return {
    processId,
    reviewId,
    args: {
      p_hub_id: overrides.hub ?? "athens",
      p_process: {
        id: processId,
        type: "civic.vote",
        process_version: "1.0",
        title: `Submit in one ${n}`,
        description: "d",
        jurisdiction: "us-va-athens",
        status: "pending_review",
        content: null,
        config: null,
        state: {},
        created_by: `user_sfr_${run}`,
      },
      p_review: {
        id: reviewId,
        process_id: processId,
        draft_id: null,
        creator_id: `user_sfr_${run}`,
        creator_name: "Test Creator",
        creator_email: `creator+sfr${run}@example.test`,
        status: "pending_review",
      },
      p_turn: {
        id: `turn_sfr_${run}_${n}`,
        review_id: reviewId,
        turn_number: 1,
        actor: `user_sfr_${run}`,
        actor_role: "creator",
        action: "submit",
        note: null,
        process_snapshot: { title: `Submit in one ${n}` },
      },
      p_links: overrides.links ?? [],
      p_event: {
        id: overrides.eventId ?? `evt_sfr_${run}_${n}`,
        version: "1.0",
        event_type: "civic.review.submitted",
        process_id: processId,
        actor: `user_sfr_${run}`,
        jurisdiction: "us-va-athens",
        action_url: `http://athens.localhost:5173/process/${processId}`,
        source: { hub_id: "civic-hub-athens", hub_url: "http://athens.localhost:3000" },
        dedupe_key: null,
        data: { process_type: "civic.vote", title: `Submit in one ${n}`, review_id: reviewId },
        meta: { visibility: "restricted" },
        created_at: new Date().toISOString(),
      },
    },
  };
}

async function written(processId: string, reviewId: string) {
  return {
    process: await rows(`processes?select=id,status,review_id,hub_id&id=eq.${processId}`),
    review: await rows(`process_reviews?select=id,process_id&id=eq.${reviewId}`),
    turns: await rows(`review_turns?select=id&review_id=eq.${reviewId}`),
    events: await rows(`events?select=id,event_type&process_id=eq.${processId}`),
    links: await rows(`process_links?select=to_id,to_iri,relation&from_id=eq.${processId}`),
  };
}

let target = "";
beforeAll(async () => {
  const [p] = await rows("processes?select=id&hub_id=eq.athens&status=eq.active&limit=1");
  target = String(p.id);
});

describe("submit_for_review", () => {
  it("writes the process, its link, the review, the back-link, the first turn and the event together", async () => {
    const s = submission("ok", { links: [{ id: `plink_sfr_${run}_1`, to_id: target, to_iri: `http://athens.localhost:5173/process/${target}`, relation: "references", created_by: `user_sfr_${run}` }] });
    const out = await rpc(s.args);
    expect(out.ok, out.ok ? "" : out.error).toBe(true);
    if (!out.ok) return;
    expect(out.body.links_skipped).toBe(0);
    expect(out.body.review).toMatchObject({ id: s.reviewId, process_id: s.processId, status: "pending_review", hub_id: "athens" });
    const w = await written(s.processId, s.reviewId);
    expect(w.process).toEqual([{ id: s.processId, status: "pending_review", review_id: s.reviewId, hub_id: "athens" }]);
    expect(w.review).toHaveLength(1);
    expect(w.turns).toHaveLength(1);
    expect(w.events.map((e) => e.event_type)).toEqual(["civic.review.submitted"]);
    expect(w.links).toEqual([{ to_id: target, to_iri: `http://athens.localhost:5173/process/${target}`, relation: "references" }]);
  });

  it("writes nothing when a write part-way through fails (the event's id is taken)", async () => {
    const first = submission("first");
    expect((await rpc(first.args)).ok).toBe(true);
    const s = submission("dup", { eventId: first.args.p_event.id });
    const out = await rpc(s.args);
    expect(out.ok).toBe(false);
    const w = await written(s.processId, s.reviewId);
    expect(w).toEqual({ process: [], review: [], turns: [], events: [], links: [] });
  });

  it("skips, and counts, a link to a process that is not there; the submission stands", async () => {
    const s = submission("gone", {
      links: [
        { id: `plink_sfr_${run}_2`, to_id: `proc_missing_${run}`, to_iri: null, relation: "references", created_by: null },
        { id: `plink_sfr_${run}_3`, to_id: target, to_iri: null, relation: "continues", created_by: null },
      ],
    });
    const out = await rpc(s.args);
    expect(out.ok, out.ok ? "" : out.error).toBe(true);
    if (!out.ok) return;
    expect(out.body.links_skipped).toBe(1);
    const w = await written(s.processId, s.reviewId);
    expect(w.process).toHaveLength(1);
    expect(w.links.map((l) => l.to_id)).toEqual([target]);
  });

  it("does not link to another hub's process", async () => {
    const [floyd] = await rows("processes?select=id&hub_id=eq.floyd&limit=1");
    const s = submission("cross", { links: [{ id: `plink_sfr_${run}_4`, to_id: floyd.id, to_iri: null, relation: "references", created_by: null }] });
    const out = await rpc(s.args);
    expect(out.ok && out.body.links_skipped).toBe(1);
    expect((await written(s.processId, s.reviewId)).links).toEqual([]);
  });

  it("refuses an event for another hub, and writes nothing", async () => {
    const s = submission("hub");
    (s.args.p_event as Record<string, unknown>).hub_id = "floyd";
    const out = await rpc(s.args);
    expect(out.ok).toBe(false);
    expect(await written(s.processId, s.reviewId)).toEqual({ process: [], review: [], turns: [], events: [], links: [] });
  });
});
