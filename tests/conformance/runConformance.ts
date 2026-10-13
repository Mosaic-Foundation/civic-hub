// The plugin conformance suite: every process type proves it behaves as its
// descriptor says, by the same steps, with no type-specific test code.
//
//   runConformance({ handlers: getAllHandlers() })   // our plugins (tests/api/conformance.test.ts)
//   runConformance({ handlers: [theirPlugin] })      // a third party's, once loaded into a hub
//
// For each type it walks what its descriptor says applies:
//   1. the static checks (src/processes/descriptorCheck.ts);
//   2. creation: a draft and Submit, which runs the Code of Conduct check
//      (flagged text refused and the draft kept; "tell the admins" queues it
//      once, flagged, never live at once; a check that can't run goes to an
//      admin); one review per draft; approval on a beta hub (review queue)
//      and on a demo hub (immediate); or an admin's create;
//   3. a failed approval leaves the submission waiting and writes no
//      `created` event;
//   4. its actions, walked from where approval leaves it: each resident
//      action is allowed to a resident, each other action refused to one;
//      every action's result is one its descriptor allows (the hub refuses
//      anything else outside production);
//   5. its deadline: exactly one close, one result, one brief where it makes
//      one, however many readers notice at once;
//   6. archive and restore;
//   7. its plugin switched off (refused everywhere) and on (back);
//   8. every event it wrote is declared by its descriptor and mapped to the
//      wire, and nothing crosses to another hub;
//   9. Tier 3: the hub's side of the external-service contract, through its
//      one adapter, with the service down, slow or erroring (fake Polis).
// Tier 2 (sandboxed) has a slot and no runtime yet.
//
// Needs the local stack and a hub server started with CIVIC_POLIS_FAKE=on and
// CIVIC_COC_FAKE=on (CIVIC_API_BASE). tests/conformance/README.md says what a plugin author
// needs to make it pass.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { accountIdOf, foreignIds } from "../fixtures/accountIds.js";
import {
  HOST_EVENT_TYPES,
  allowedTargets,
  type ActionDescriptor,
  type ProcessTypeDescriptor,
} from "../../src/processes/descriptor.js";
import { checkDescriptor, type HostFacts } from "../../src/processes/descriptorCheck.js";
import type { ProcessHandler } from "../../src/processes/types.js";
import type { ProcessStatus } from "../../src/models/process.js";
import { hostFacts } from "./hostFacts.js";
import {
  BETA,
  DEMO,
  act,
  admin,
  adminCreate,
  approve,
  briefsOf,
  draftOf,
  reviewsOfDraft,
  tellAdmins,
  eventsOf,
  examplePayload,
  expireDeadline,
  FAILS_ON_APPROVAL,
  installApprovalTrap,
  releaseFromTrap,
  removeApprovalTrap,
  fakePolis,
  liveProcess,
  processRow,
  resident,
  reviewOf,
  setPlugin,
  submitDraft,
  uniqueTitle,
  type Hub,
} from "./driver.js";

export interface ConformanceOptions {
  /** The process types to prove: their handlers, as the hub registered them. */
  handlers: readonly ProcessHandler[];
  /** What the hub knows (its plugin ids, wire mappings, tables). Default: this hub's. */
  facts?: HostFacts;
}

/** One step of the walk, replayable on a fresh process to reach the same status. */
interface Step {
  action: string;
  as: "admin" | "resident" | "creator";
  /** A threshold action, run by this many different residents. */
  times: number;
}

/** What the walk learned about a type: the statuses it reached, and how. */
interface Walked {
  paths: Map<ProcessStatus, Step[]>;
  processIds: string[];
}

const MAX_THRESHOLD = 12;

export function runConformance(options: ConformanceOptions): void {
  const facts = options.facts ?? hostFacts();
  // Step 3's trap: one trigger for the whole run, not one per test.
  beforeAll(installApprovalTrap);
  afterAll(removeApprovalTrap);

  describe("the hub serves each type's public descriptor", () => {
    it("GET /.well-known/civic.json lists the public parts of every enabled type, and nothing internal", async () => {
      const res = await call("GET", "/.well-known/civic.json", BETA.host);
      expect(res.status).toBe(200);
      const served = res.body.process_types as Array<Record<string, unknown>>;
      for (const h of options.handlers) {
        const entry = served.find((t) => t.type === h.type);
        expect(entry, `${h.type} missing from process_types`).toBeTruthy();
        expect(Object.keys(entry!).sort()).toEqual(["actions", "emits", "lifecycle", "tier", "type", "version"]);
      }
    });
  });

  for (const handler of options.handlers) {
    const d = handler.descriptor;
    describe(`${d?.type ?? handler.type} (tier ${d?.tier ?? "?"})`, () => {
      it("1. its descriptor is well formed and agrees with its handler", () => {
        expect(checkDescriptor(handler, facts)).toEqual([]);
      });
      if (!d) return;
      if (!d.creation.resident && !d.creation.admin) {
        // Made only by the hub itself (a brief on a close, a meeting summary
        // from a job). Its static checks ran above; the walks of the types
        // that make one cover it in use (a brief: step 5 of every type with
        // a brief). Recorded so the gap is visible, not silent.
        it.skip(`2–9. not walked: only the hub creates a ${d.type}`, () => {});
        return;
      }
      conformanceWalk(d, facts);
    });
  }

  describe("tier 2 (sandboxed plugins)", () => {
    // Plugin architecture §2 and §5a: a sandboxed plugin's capabilities are
    // the host functions its runtime exposes. No runtime exists, so no type
    // may declare tier 2 (step 1 refuses it). When one does, this block runs
    // every step above against the plugin inside the sandbox, plus: an
    // emission outside its grant is refused by the runtime, a call to a host
    // it did not declare (network.egress) fails, and it sees only the
    // identity claims it was granted. See tests/conformance/README.md.
    it.todo("runs steps 1–9 inside the sandbox runtime, and checks the grant is enforced by it");
  });
}

function conformanceWalk(d: ProcessTypeDescriptor, facts: HostFacts): void {
  const touched: Array<{ id: string; hub: Hub }> = [];
  const walked: Walked = { paths: new Map(), processIds: [] };

  if (d.creation.resident) {
    describe("2. creation through a draft", () => {
      // Submit runs the Code of Conduct check (Submit and Save, 2026-10-12),
      // through the one drafts path every type shares. The hub runs the fake
      // check (CIVIC_COC_FAKE=on), which answers to a marker in the text.
      it("Submit runs the check: flagged text is refused, says what to fix, and the draft is kept", async () => {
        const { token } = await resident(BETA);
        const s = await submitDraft(d, facts, BETA, token, { check: "flagged" });
        expect(s.status, `${JSON.stringify(s.body)} (is the hub running CIVIC_COC_FAKE=on?)`).toBe(400);
        expect(s.body.code).toBe("code_of_conduct_flagged");
        const findings = s.body.findings as Array<{ field: string | null; message: string }>;
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0].field).toBe("description");
        expect(findings[0].message).toBeTruthy();
        const kept = await draftOf(d, BETA, token, s.draftId);
        expect(kept.body.status).toBe("drafting");
        expect(await reviewsOfDraft(s.draftId)).toHaveLength(0);
      });

      for (const hub of [BETA, DEMO]) {
        it(`"tell the admins" on a ${hub === BETA ? "beta" : "demo"} hub reaches the queue once, flagged, with the note`, async () => {
          const { token } = await resident(hub);
          const s = await submitDraft(d, facts, hub, token, { check: "flagged" });
          expect(s.status).toBe(400);
          const note = "I think the check misread this.";
          const told = await Promise.all([0, 1, 2].map(() => tellAdmins(d, hub, token, s.draftId, note)));
          const ok = told.filter((r) => r.status === 201);
          expect(ok, JSON.stringify(told.map((r) => [r.status, r.body]))).toHaveLength(1);
          for (const r of told.filter((x) => x.status !== 201)) expect(r.status).toBe(409);
          // Never published at once, not even on a demo hub.
          expect(ok[0].body.auto_approved).toBe(false);
          expect(ok[0].body.flagged).toBe(true);
          const reviews = await reviewsOfDraft(s.draftId);
          expect(reviews).toHaveLength(1);
          expect(reviews[0].status).toBe("pending_review");
          expect(reviews[0].coc_flags?.length).toBeGreaterThan(0);
          expect(reviews[0].note).toBe(note);
          expect((await processRow(reviews[0].process_id)).status).toBe("pending_review");
          touched.push({ id: reviews[0].process_id, hub });
        });
      }

      it("when the check can't run, the submission goes to an admin, never live at once", async () => {
        const { token } = await resident(DEMO);
        const s = await submitDraft(d, facts, DEMO, token, { check: "unavailable" });
        expect(s.status, JSON.stringify(s.body)).toBe(201);
        expect(s.body.auto_approved).toBe(false);
        expect(s.body.check_unavailable).toBe(true);
        expect((await processRow(s.processId)).status).toBe("pending_review");
        touched.push({ id: s.processId, hub: DEMO });
      });

      it("one review per draft, however many submits arrive at once", async () => {
        const { token } = await resident(BETA);
        const first = await submitDraft(d, facts, BETA, token, { check: "unavailable" });
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        touched.push({ id: first.processId, hub: BETA });
        const again = await Promise.all(
          [0, 1, 2].map(() => call("POST", `${d.creation.resident!.drafts}/${first.draftId}/submit`, BETA.host, {}, token)),
        );
        for (const r of again) expect(r.status).toBe(409);
        expect(await reviewOf(first.processId)).toHaveLength(1);
      });

      it("on a beta hub it waits for an admin, then goes live on approval", async () => {
        const { token } = await resident(BETA);
        const s = await submitDraft(d, facts, BETA, token, { check: "passed" });
        expect(s.status, JSON.stringify(s.body)).toBe(201);
        expect(s.body.auto_approved).toBe(false);
        expect((await processRow(s.processId)).status).toBe("pending_review");
        expect((await call("GET", `/process/${s.processId}/state`, BETA.host)).status).toBe(404);
        const ok = await approve(BETA, await admin(BETA), s.reviewId);
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        const row = await processRow(s.processId);
        expect([...d.states]).toContain(row.status);
        touched.push({ id: s.processId, hub: BETA });
        expect(await createdEvents(s.processId)).toBeLessThanOrEqual(1);
      });

      it("on a demo hub a passed check goes live at once", async () => {
        const { token } = await resident(DEMO);
        const s = await submitDraft(d, facts, DEMO, token, { check: "passed" });
        expect(s.status, JSON.stringify(s.body)).toBe(201);
        expect(s.body.auto_approved).toBe(true);
        expect([...d.states]).toContain((await processRow(s.processId)).status);
        touched.push({ id: s.processId, hub: DEMO });
      });
    });

    describe("3. a failed approval", () => {
      it("on a beta hub leaves the submission waiting, with no created event; the retry writes one", async () => {
        const { token } = await resident(BETA);
        const title = uniqueTitle(FAILS_ON_APPROVAL);
        const s = await submitDraft(d, facts, BETA, token, { check: "unavailable", title });
        expect(s.status).toBe(201);
        const failed = await approve(BETA, await admin(BETA), s.reviewId);
        expect(failed.status).toBeGreaterThanOrEqual(400);
        expect((await reviewOf(s.processId))[0].status).toBe("pending_review");
        expect((await processRow(s.processId)).status).toBe("pending_review");
        expect(publicTrace(await eventsOf(s.processId))).toEqual([]);

        await releaseFromTrap(s.processId);
        const retried = await approve(BETA, await admin(BETA), s.reviewId);
        expect(retried.status, JSON.stringify(retried.body)).toBe(200);
        expect(await createdEvents(s.processId)).toBeLessThanOrEqual(1);
        touched.push({ id: s.processId, hub: BETA });
      });

      it("on a demo hub the submit still succeeds and waits for an admin", async () => {
        const { token } = await resident(DEMO);
        const title = uniqueTitle(FAILS_ON_APPROVAL);
        const s = await submitDraft(d, facts, DEMO, token, { check: "passed", title });
        expect(s.status, JSON.stringify(s.body)).toBe(201);
        expect(s.body.auto_approved).toBe(false);
        expect((await reviewOf(s.processId))[0].status).toBe("pending_review");
        expect(publicTrace(await eventsOf(s.processId))).toEqual([]);
      });
    });
  } else {
    describe("2. creation by an admin", () => {
      it("an admin creates one from the example; a resident cannot", async () => {
        const { processId, res } = await adminCreate(d, BETA);
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
        expect([...d.states]).toContain((await processRow(processId)).status);
        touched.push({ id: processId, hub: BETA });
        const { token } = await resident(BETA);
        const { path = "/process", body } = d.examples.create!;
        const refused = await call("POST", path, BETA.host, body, token);
        expect([401, 403]).toContain(refused.status);
      });
    });
  }

  describe("4. its actions, walked from where it goes live", () => {
    it("residents may call what the descriptor opens to them, and nothing else; every result is declared", async () => {
      const creator = await resident(BETA);
      const id = await liveAs(d, facts, BETA, creator.token);
      touched.push({ id, hub: BETA });
      walked.processIds.push(id);
      const start = (await processRow(id)).status as ProcessStatus;
      walked.paths.set(start, []);
      const queue: ProcessStatus[] = [start];
      while (queue.length > 0) {
        const status = queue.shift()!;
        // Replay the path to this status on the walk's own process, if the
        // process has moved on (each branch is walked on a fresh one).
        let current = id;
        if ((await processRow(id)).status !== status) {
          current = await liveAs(d, facts, BETA, creator.token);
          touched.push({ id: current, hub: BETA });
          await replay(d, BETA, current, walked.paths.get(status)!, creator.token);
        }
        await refusals(d, BETA, current, status, creator.token);
        for (const next of await advance(d, BETA, current, status, creator.token)) {
          if (walked.paths.has(next.status)) continue;
          walked.paths.set(next.status, [...walked.paths.get(status)!, ...next.steps]);
          queue.push(next.status);
          // The process is now at next.status; continue from a fresh one next time.
          break;
        }
      }
      for (const s of walked.paths.keys()) expect([...d.states, "pending_review"]).toContain(s);
      // After every action, the process as a resident and a visitor read it
      // carries no one's account id (the actors of the walk are all in it).
      const reader = (await resident(BETA)).token;
      for (const [token, own] of [[reader, await accountIdOf(BETA.host, reader)], [undefined, null]] as const) {
        const read = await call("GET", `/process/${id}/state`, BETA.host, undefined, token);
        expect(foreignIds(read.body, own), `${d.type} read by a ${token ? "resident" : "visitor"}`).toEqual([]);
      }
    }, 120_000);
  });

  const once = d.actions.filter((a) => a.once_per_participant && walker(a) === "resident");
  if (once.length > 0) {
    describe("4b. once per participant", () => {
      for (const a of once) {
        it(`${a.name}: one person's simultaneous calls count once; the rest are refused with 409`, async () => {
          const creator = await resident(BETA);
          const id = await liveAs(d, facts, BETA, creator.token);
          touched.push({ id, hub: BETA });
          await reachOneOf(d, walked, BETA, id, a.from, creator.token);
          const { token } = await resident(BETA);
          const payload = examplePayload(d, a.name, await processRow(id));
          const results = await Promise.all(Array.from({ length: 5 }, () => act(BETA, id, a.name, payload, token)));
          const own = await accountIdOf(BETA.host, token);
          for (const r of results) expect(foreignIds(r.body, own), `${a.name}: another person's account id`).toEqual([]);
          const statuses = results.map((r) => r.status).sort();
          expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 409, 409, 409, 409]);
          const events = (await eventsOf(id)).filter((e) => a.emits.includes(e.event_type));
          expect(events.length, `${a.name} events`).toBeLessThanOrEqual(a.emits.length);
        }, 60_000);
      }
    });
  }

  if (d.deadline) {
    describe("5. the deadline", () => {
      it("closes exactly once, with one result and one brief, however many readers notice at once", async () => {
        const creator = await resident(BETA);
        const id = await liveAs(d, facts, BETA, creator.token);
        touched.push({ id, hub: BETA });
        const close = d.actions.find((a) => a.name === d.deadline!.action)!;
        await reachOneOf(d, walked, BETA, id, close.from, creator.token);
        // By id, not position: a deadline close is stamped with the deadline,
        // which is in the past, so its events sort before ones already there.
        const before = new Set((await eventsOf(id)).map((e) => e.id));
        await expireDeadline(d, id);
        const reads = await Promise.all([
          ...Array.from({ length: 6 }, () => call("GET", `/process/${id}/state`, BETA.host)),
          ...Array.from({ length: 3 }, () => call("GET", `/process?type=${d.type}`, BETA.host)),
        ]);
        for (const r of reads) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
        const row = await processRow(id);
        const fromStatus = close.from[0];
        expect([...allowedTargets(close, fromStatus)]).toContain(row.status);
        const after = (await eventsOf(id)).filter((e) => !before.has(e.id));
        for (const type of close.emits) {
          expect(after.filter((e) => e.event_type === type), `${type} after the deadline`).toHaveLength(1);
        }
        expect(await briefsOf(id)).toHaveLength(d.brief ? 1 : 0);
      }, 60_000);
    });
  }

  describe("6. archive and restore", () => {
    it("an archived one is gone from residents and its actions; restore puts it back where it was", async () => {
      const id = await liveProcess(d, facts, BETA);
      touched.push({ id, hub: BETA });
      const before = (await processRow(id)).status;
      const adminToken = await admin(BETA);
      const archived = await call("POST", `/admin/processes/${id}/archive`, BETA.host, { reason: "Conformance" }, adminToken);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect((await processRow(id)).status).toBe("archived");
      expect((await call("GET", `/process/${id}/state`, BETA.host)).status).toBe(404);
      const { token } = await resident(BETA);
      for (const a of d.actions.filter((x) => x.callers.includes("resident"))) {
        expect((await act(BETA, id, a.name, examplePayload(d, a.name, await processRow(id)), token)).status).toBe(404);
      }
      const restored = await call("POST", `/admin/processes/${id}/restore`, BETA.host, {}, adminToken);
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      expect((await processRow(id)).status).toBe(before);
    });
  });

  describe("7. the plugin switch", () => {
    let id = "";
    beforeAll(async () => {
      id = await liveProcess(d, facts, DEMO);
      touched.push({ id, hub: DEMO });
    });
    afterAll(async () => {
      await setPlugin(DEMO, d.plugin, true);
    });

    it("off: refused everywhere; on: back as it was", async () => {
      const adminToken = await admin(DEMO);
      const { token } = await resident(DEMO);
      const before = (await processRow(id)).status;
      await setPlugin(DEMO, d.plugin, false);
      expect((await call("GET", `/process/${id}`, DEMO.host)).status).toBe(404);
      expect((await call("GET", `/process/${id}/state`, DEMO.host)).status).toBe(404);
      for (const a of d.actions) {
        for (const t of [token, adminToken]) {
          expect((await act(DEMO, id, a.name, examplePayload(d, a.name, await processRow(id)), t)).status).toBe(404);
        }
      }
      const listed = await call("GET", `/process?type=${d.type}`, DEMO.host);
      expect(JSON.stringify(listed.body)).not.toContain(id);
      if (d.creation.resident) {
        expect((await call("POST", d.creation.resident.drafts, DEMO.host, {}, token)).status).toBeGreaterThanOrEqual(400);
      }
      const manifest = await call("GET", "/.well-known/civic.json", DEMO.host);
      expect((manifest.body.processes as string[]).includes(d.type)).toBe(false);
      expect((await processRow(id)).status).toBe(before);

      await setPlugin(DEMO, d.plugin, true);
      expect((await call("GET", `/process/${id}/state`, DEMO.host)).status).toBe(200);
      expect((await processRow(id)).status).toBe(before);
    });
  });

  describe("8. events and hubs", () => {
    it("every event it wrote is declared by its descriptor and mapped to the wire", async () => {
      expect(touched.length).toBeGreaterThan(0);
      const declared = new Set([...HOST_EVENT_TYPES, ...d.emits]);
      for (const { id } of touched) {
        for (const e of await eventsOf(id)) {
          expect(declared.has(e.event_type), `${id}: ${e.event_type} is not declared`).toBe(true);
          expect(facts.mappedEventTypes, `${e.event_type} has no wire mapping`).toContain(e.event_type);
        }
      }
    });

    it("nothing crosses to another hub", async () => {
      for (const { id, hub } of touched) {
        const other = hub.slug === BETA.slug ? DEMO : BETA;
        expect((await processRow(id)).hub_id).toBe(hub.slug);
        for (const e of await eventsOf(id)) expect(e.hub_id).toBe(hub.slug);
        expect((await call("GET", `/process/${id}/state`, other.host)).status).toBe(404);
        expect((await call("GET", `/process/${id}`, other.host)).status).toBe(404);
        const { token } = await resident(other);
        for (const a of d.actions.filter((x) => x.callers.includes("resident"))) {
          expect((await act(other, id, a.name, {}, token)).status).toBe(404);
        }
        const feed = await call("GET", `/events?process_id=${id}`, other.host);
        expect(JSON.stringify(feed.body)).not.toContain(id);
      }
    });
  });

  for (const service of d.outside_services) tierThree(d, facts, service, touched);
}

// --- The walk ------------------------------------------------------------------

/** A live process created by `creatorToken` (a resident) where the type allows; otherwise by an admin. */
async function liveAs(d: ProcessTypeDescriptor, facts: HostFacts, hub: Hub, creatorToken: string): Promise<string> {
  if (!d.creation.resident) return liveProcess(d, facts, hub);
  const s = await submitDraft(d, facts, hub, creatorToken, { check: "unavailable" });
  if (s.status !== 201) throw new Error(`${d.type}: submit answered ${s.status} ${JSON.stringify(s.body)}`);
  const ok = await approve(hub, await admin(hub), s.reviewId);
  if (ok.status !== 200) throw new Error(`${d.type}: approval answered ${ok.status} ${JSON.stringify(ok.body)}`);
  return s.processId;
}

async function tokenFor(as: Step["as"], hub: Hub, creatorToken: string): Promise<string> {
  if (as === "admin") return admin(hub);
  if (as === "creator") return creatorToken;
  return (await resident(hub)).token;
}

/** Who calls an action in the walk: a resident if it is theirs, else the creator, else an admin. */
function walker(a: ActionDescriptor): Step["as"] | null {
  if (a.callers.includes("resident")) return "resident";
  if (a.callers.includes("creator")) return "creator";
  if (a.callers.includes("admin")) return "admin";
  return null; // system only: the hub's, never a caller's
}

/** Every action not open to residents is refused to a resident who is not the creator. */
async function refusals(d: ProcessTypeDescriptor, hub: Hub, id: string, status: ProcessStatus, creatorToken: string) {
  const stranger = (await resident(hub)).token;
  for (const a of d.actions.filter((x) => x.from.includes(status))) {
    if (a.callers.includes("resident")) continue;
    const res = await act(hub, id, a.name, examplePayload(d, a.name, await processRow(id)), stranger);
    expect(res.status, `${d.type} ${a.name} as a resident: ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body.code).toBe("admin_required");
    if (!a.callers.includes("creator")) {
      const asCreator = await act(hub, id, a.name, examplePayload(d, a.name, await processRow(id)), creatorToken);
      expect(asCreator.status, `${d.type} ${a.name} as its creator`).toBe(403);
    }
  }
}

/**
 * Run the actions available at `status` until one moves the process; the
 * statuses it reached, with the steps that got there. Resident actions run
 * first (each is allowed to a resident: not refused for their role, never a
 * 500), repeated by different residents for a threshold; then the actions
 * an admin or the creator drives.
 */
async function advance(
  d: ProcessTypeDescriptor,
  hub: Hub,
  id: string,
  status: ProcessStatus,
  creatorToken: string,
): Promise<Array<{ status: ProcessStatus; steps: Step[] }>> {
  const out: Array<{ status: ProcessStatus; steps: Step[] }> = [];
  const available = d.actions.filter((a) => a.from.includes(status) && walker(a));
  const ordered = [
    ...available.filter((a) => walker(a) === "resident"),
    ...available.filter((a) => walker(a) !== "resident"),
  ];
  for (const a of ordered) {
    const as = walker(a)!;
    const moves = allowedTargets(a, status).some((t) => t !== status);
    const limit = as === "resident" && moves ? MAX_THRESHOLD : 1;
    for (let times = 1; times <= limit; times++) {
      const token = await tokenFor(as, hub, creatorToken);
      const res = await act(hub, id, a.name, examplePayload(d, a.name, await processRow(id)), token);
      expect(res.status, `${d.type} ${a.name} from ${status} as ${as}: ${JSON.stringify(res.body)}`).toBeLessThan(500);
      if (res.status < 300) {
        // The answer carries what the page needs to show the result at once:
        // the process exactly as the caller's next read of it.
        const fresh = await call("GET", `/process/${id}/state`, hub.host, undefined, token);
        expect(res.body.view, `${d.type} ${a.name}: the answer's view`).toEqual(fresh.status === 200 ? fresh.body : null);
      }
      if (as !== "admin") {
        expect(res.body.code, `${d.type} ${a.name} refused to a ${as}`).not.toBe("admin_required");
        // An account id goes only to its owner and the hub's admins.
        expect(foreignIds(res.body, await accountIdOf(hub.host, token)), `${d.type} ${a.name}: another person's account id`).toEqual([]);
      }
      const now = (await processRow(id)).status as ProcessStatus;
      if (res.status < 300) expect([...allowedTargets(a, status)]).toContain(now);
      if (now !== status) {
        out.push({ status: now, steps: [{ action: a.name, as, times }] });
        return out;
      }
      if (res.status >= 300) break;
    }
  }
  return out;
}

async function replay(d: ProcessTypeDescriptor, hub: Hub, id: string, steps: Step[], creatorToken: string) {
  for (const step of steps) {
    for (let i = 0; i < step.times; i++) {
      const res = await act(hub, id, step.action, examplePayload(d, step.action, await processRow(id)), await tokenFor(step.as, hub, creatorToken));
      expect(res.status, `${d.type} replaying ${step.action}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    }
  }
}

/** Bring a fresh process to one of `statuses` by the path the walk found. */
async function reachOneOf(
  d: ProcessTypeDescriptor,
  walked: Walked,
  hub: Hub,
  id: string,
  statuses: readonly ProcessStatus[],
  creatorToken: string,
) {
  if (statuses.includes((await processRow(id)).status as ProcessStatus)) return;
  const target = statuses.find((s) => walked.paths.has(s));
  if (!target) throw new Error(`${d.type}: the walk never reached ${statuses.join(" or ")}`);
  await replay(d, hub, id, walked.paths.get(target)!, creatorToken);
}

// --- Events ---------------------------------------------------------------------

/** What a process left in the public log: everything but the review's restricted events. */
function publicTrace(events: Array<{ event_type: string }>): string[] {
  return events.map((e) => e.event_type).filter((t) => !t.startsWith("civic.review."));
}

async function createdEvents(id: string): Promise<number> {
  return (await eventsOf(id)).filter((e) => e.event_type === "civic.process.created").length;
}

// --- Tier 3 --------------------------------------------------------------------

function tierThree(
  d: ProcessTypeDescriptor,
  facts: HostFacts,
  service: ProcessTypeDescriptor["outside_services"][number],
  touched: Array<{ id: string; hub: Hub }>,
): void {
  describe(`9. tier 3: ${service.name}, through its one adapter`, () => {
    beforeAll(async () => {
      const state = await fakePolis(BETA, { mode: "up", clear_calls: true });
      if (state.status !== 200) throw new Error("tier 3 checks need the hub started with CIVIC_POLIS_FAKE=on");
    });
    afterAll(async () => {
      await fakePolis(BETA, { mode: "up" });
    });

    const participate = (id: string, token: string, hub: Hub = BETA) =>
      Promise.all(
        service.participation.map((r) => call(r.method, r.path.replace(":id", id), hub.host, r.body, token)),
      );

    it("each participant crosses the boundary as themselves; the declaration says how", async () => {
      const id = await liveProcess(d, facts, BETA);
      touched.push({ id, hub: BETA });
      await fakePolis(BETA, { clear_calls: true });
      const a = await resident(BETA);
      const b = await resident(BETA);
      for (const r of await participate(id, a.token)) expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      await participate(id, b.token);
      const calls = (await fakePolis(BETA)).calls.filter((c) => c.xid);
      const xids = new Set(calls.map((c) => c.xid));
      // §10a.1: one identifier per participant, stable across their calls.
      expect(xids.size).toBe(2);
      const credentials = new Set(calls.map((c) => c.credential));
      const shared = credentials.size === 1;
      // Reported, not fixed (Adam, 2026-10-12): the declaration must be honest.
      expect(service.service_credential).toBe(shared ? "shared_service_token" : "per_participant");
      if (shared) console.warn(`[conformance] ${d.type}: ${service.name} — one shared service token stands in for every participant (§10a.1)`);
      if (service.participant_identifier === "account_id") {
        console.warn(`[conformance] ${d.type}: ${service.name} is given the hub's account id, not an opaque per-participant identifier (§10a.1)`);
      }
      if (!service.service_allowlist) {
        console.warn(`[conformance] ${d.type}: ${service.name} does not itself refuse participants the hub did not allow (§10a.5)`);
      }
    });

    it("the hub decides who takes part: signed out, another hub's resident, a closed process", async () => {
      const id = await liveProcess(d, facts, BETA);
      touched.push({ id, hub: BETA });
      await fakePolis(BETA, { clear_calls: true });
      for (const r of await participate(id, "")) expect(r.status).toBe(401);
      const outsider = await resident(DEMO);
      for (const r of await participate(id, outsider.token, DEMO)) expect(r.status).toBe(404);
      const close = d.actions.find((x) => x.name === d.deadline?.action)!;
      expect((await act(BETA, id, close.name, {}, await admin(BETA))).status).toBeLessThan(300);
      await fakePolis(BETA, { clear_calls: true });
      const late = await resident(BETA);
      for (const r of await participate(id, late.token)) expect(r.status).toBe(409);
      expect((await fakePolis(BETA)).calls).toEqual([]);
    });

    for (const mode of ["down", "slow", "error"] as const) {
      it(`${service.name} ${mode}: the close still happens, once, and is announced`, async () => {
        const id = await liveProcess(d, facts, BETA);
        touched.push({ id, hub: BETA });
        const close = d.actions.find((x) => x.name === d.deadline?.action)!;
        await fakePolis(BETA, { mode, slow_ms: 2_000 });
        try {
          if (mode === "down") {
            // The hub drives the deadline itself (§10a.3): a read notices it.
            await expireDeadline(d, id);
            await Promise.all(Array.from({ length: 4 }, () => call("GET", `/process/${id}/state`, BETA.host)));
          } else {
            const res = await act(BETA, id, close.name, {}, await admin(BETA));
            expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
          }
        } finally {
          await fakePolis(BETA, { mode: "up" });
        }
        const row = await processRow(id);
        expect([...allowedTargets(close, close.from[0])]).toContain(row.status);
        for (const type of close.emits) {
          expect((await eventsOf(id)).filter((e) => e.event_type === type)).toHaveLength(1);
        }
      }, 60_000);
    }
  });
}
