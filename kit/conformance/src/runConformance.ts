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
//      one, however many readers notice at once; and the hourly job closes it
//      when nobody reads it at all;
//   6. archive and restore;
//   7. its plugin switched off (refused everywhere) and on (back);
//   8. every event it wrote is declared by its descriptor and mapped to the
//      wire, and nothing crosses to another hub;
//   9. Tier 3: the hub's side of the external-service contract, through its
//      one adapter, with the service down, slow or erroring (fake Polis);
//  10. what counts as its participation is declared (ADR-016): at least one
//      participation event, or "elsewhere" or "none" said outright; every
//      resident's action that emits anything emits an event it counts.
//  11–17. what SDK v1 promises (engine 2, ADR-017), each where the type
//      uses it: 11 an edit through the hub's edit path (the check refuses
//      flagged text, a clean edit is recorded, a stranger may not); 12 a
//      retry-safe action called twice at once writes its events once; 13
//      names go to whom its disclosure policy says, never an account; 14 its
//      own statuses are cases of its hub status; 15 its own card kind has its
//      colour family, stylesheet and digest section; 16 an official may call
//      what is open to officials, and publishes at once where declared; 17
//      its own pages draw with the hub's UI kit.
//  18. images its residents attach (Events 2, E1): a type that declares
//      `uploads` takes one through the hub's upload route; one that does not
//      is refused it.
//  19. telling people (Events 2, E2): a package that calls notify() names
//      `mail` in its grant.
//  20. the hub in scope (Events 2, E3): its code names no time zone and no
//      hub's address; hubContext() gives the hub's.
// Tier 2 (sandboxed) has a slot and no runtime yet.
//
// Needs the local stack and a hub server started with CIVIC_POLIS_FAKE=on and
// CIVIC_COC_FAKE=on (CIVIC_API_BASE). kit/conformance/README.md says what a plugin author
// needs to make it pass.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOST_ROOT } from "@civic-social/plugin-sdk/host";
import { call, callUpload, pngOf } from "./support/http.js";
import { accountIdOf, foreignIds } from "./support/accountIds.js";
import { localRest, localStack } from "./support/localStack.js";
import {
  HOST_EVENT_TYPES,
  JOBS,
  JOBS_MOUNT,
  allowedTargets,
  checkDescriptor,
  getManifest,
  participationProblem,
  publicPayloadKeys,
  rowToEvent,
  namesFor,
  namesShown,
  disclosurePolicyOf,
  typeStatusOf,
  DECLARED_FEED_KINDS,
  classifyActivity,
  THEME_TYPE_KEYS,
  declaredTypeStylesheet,
  FAKE_COC_FLAG,
  loadedPackages,
  toActivity,
  toRedactedActivity,
  withHubScope,
  type ActionDescriptor,
  type HostFacts,
  type ProcessHandler,
  type ProcessStatus,
  type ProcessTypeDescriptor,
} from "@civic-social/plugin-sdk/testing";
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
  eventRowsOf,
  hubRow,
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

  const d0 = (h: ProcessHandler) => h.descriptor;
  describe("the hub serves each type's public descriptor", () => {
    it("GET /.well-known/civic.json lists the public parts of every enabled type, and nothing internal", async () => {
      const res = await call("GET", "/.well-known/civic.json", BETA.host);
      expect(res.status).toBe(200);
      const served = res.body.process_types as Array<Record<string, unknown>>;
      for (const h of options.handlers) {
        const entry = served.find((t) => t.type === h.type);
        expect(entry, `${h.type} missing from process_types`).toBeTruthy();
        expect(Object.keys(entry!).sort()).toEqual(["actions", "display", "emits", "lifecycle", "tier", "type", "version"]);
        // Its display name (Architecture 2): a consumer names a type without the hub's UI.
        expect(entry!.display, h.type).toEqual({ label: d0(h).display.label, plural: d0(h).display.plural });
      }
    });
  });

  for (const handler of options.handlers) {
    const d = handler.descriptor;
    describe(`${d?.type ?? handler.type} (tier ${d?.tier ?? "?"})`, () => {
      it("1. its descriptor is well formed and agrees with its handler", () => {
        expect(checkDescriptor(handler, facts)).toEqual([]);
      });
      it("10. what counts as its participation is declared", () => {
        expect(d, `${handler.type} has no descriptor`).toBeTruthy();
        const decl = getManifest(d!.type)?.participation;
        expect(decl, `${d!.type}: the manifest declares no "participation" (kit/conformance/README.md, step 10)`).toBeTruthy();
        expect(participationProblem(decl, { emits: d!.emits, hostTypes: HOST_EVENT_TYPES })).toBeNull();
        // Every resident's or creator's action that emits anything emits at
        // least one event the declaration counts (a support that also opens a
        // vote emits its threshold event and the vote's start).
        // A withdrawal (taking back "going"; E17) is accounted for, and
        // counted as nothing.
        const counted = new Set(
          decl!.participation === "elsewhere" || decl!.participation === "none"
            ? [...decl!.creation, ...decl!.closing, ...decl!.outcome, ...(decl!.withdrawal ?? [])]
            : [...decl!.participation, ...decl!.creation, ...decl!.closing, ...decl!.outcome, ...(decl!.withdrawal ?? [])],
        );
        for (const a of d!.actions.filter((x) => x.callers.includes("resident") || x.callers.includes("creator") || (x.callers as readonly string[]).includes("official"))) {
          if (a.emits.length === 0) continue;
          expect(
            a.emits.some((e) => counted.has(e)),
            `${d!.type}: ${a.name} emits ${a.emits.join(", ")}, none of which its participation declaration counts`,
          ).toBe(true);
        }
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
    // identity claims it was granted. See kit/conformance/README.md.
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
      // Past the deadline, reads write nothing (a GET never closes,
      // Architecture 2): the process reads as closed and refuses residents
      // with its type's own answer, and the hourly job closes it, once,
      // however many runs overlap.
      it("past the deadline it reads as closed and refuses residents; the job closes it exactly once, with one result and one brief", async () => {
        const creator = await resident(BETA);
        const id = await liveAs(d, facts, BETA, creator.token);
        touched.push({ id, hub: BETA });
        const close = d.actions.find((a) => a.name === d.deadline!.action)!;
        await reachOneOf(d, walked, BETA, id, close.from, creator.token);
        // By id, not position: a deadline close is stamped with the deadline,
        // which is in the past, so its events sort before ones already there.
        const before = new Set((await eventsOf(id)).map((e) => e.id));
        const stored = (await processRow(id)).status;
        await expireDeadline(d, id);

        const reads = await Promise.all([
          ...Array.from({ length: 6 }, () => call("GET", `/process/${id}/state`, BETA.host)),
          ...Array.from({ length: 3 }, () => call("GET", `/process?type=${d.type}`, BETA.host)),
        ]);
        for (const r of reads) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
        const listed = (reads[6].body as Array<{ id: string; status?: string }>).find((p) => p.id === id);
        expect(listed?.status, "the list reads it as closed").toBe("closed");
        expect((await processRow(id)).status, "a read writes nothing").toBe(stored);
        expect((await eventsOf(id)).filter((e) => !before.has(e.id)), "a read emits nothing").toHaveLength(0);

        // A resident's action (or, for an outside service, taking part) gets
        // what a closed one answers.
        const refusal = getManifest(d.type)?.deadlineRefusal;
        const residentAction = d.actions.find(
          (a) => a.name !== close.name && a.callers.includes("resident") && a.from.includes(stored as ProcessStatus),
        );
        const voter = await resident(BETA);
        const refused = residentAction
          ? [await act(BETA, id, residentAction.name, examplePayload(d, residentAction.name, await processRow(id)), voter.token)]
          : await Promise.all(
              d.outside_services.flatMap((svc) =>
                svc.participation.map((r) => call(r.method, r.path.replace(":id", id), BETA.host, r.body, voter.token)),
              ),
            );
        for (const r of refused) {
          expect(r.status, JSON.stringify(r.body)).toBe(409);
          if (refusal) expect(r.body.code).toBe(refusal.code);
        }

        const job = JOBS.find((j) => j.id === "vote_close")!;
        const cron = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
        const runs = await Promise.all(
          Array.from({ length: 3 }, () => call("GET", `${JOBS_MOUNT}${job.path}?hub=${BETA.slug}`, BETA.host, undefined, cron)),
        );
        for (const r of runs) expect(r.status, JSON.stringify(r.body)).toBe(200);
        const row = await processRow(id);
        const fromStatus = close.from[0];
        expect([...allowedTargets(close, fromStatus)]).toContain(row.status);
        const after = (await eventsOf(id)).filter((e) => !before.has(e.id));
        for (const type of close.emits) {
          expect(after.filter((e) => e.event_type === type), `${type} after the deadline`).toHaveLength(1);
        }
        expect(await briefsOf(id)).toHaveLength(d.brief ? 1 : 0);
      }, 60_000);

      // Every type with a deadline, not only votes (2026-10-13): before, a
      // proposal or conversation nobody opened stayed open past it.
      it("the hourly job closes it with nobody reading it", async () => {
        const creator = await resident(BETA);
        const id = await liveAs(d, facts, BETA, creator.token);
        touched.push({ id, hub: BETA });
        const close = d.actions.find((a) => a.name === d.deadline!.action)!;
        await reachOneOf(d, walked, BETA, id, close.from, creator.token);
        await expireDeadline(d, id);
        const job = JOBS.find((j) => j.id === "vote_close")!;
        const cron = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
        const res = await call("GET", `${JOBS_MOUNT}${job.path}?hub=${BETA.slug}`, BETA.host, undefined, cron);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.hubs[BETA.slug].closed).toContain(id);
        expect([...allowedTargets(close, close.from[0])]).toContain((await processRow(id)).status);
      }, 60_000);
    });

    describe("5b. close early", () => {
      it("an admin closing before the deadline must give a note; the close records it on the page, the brief and the admin log", async () => {
        const creator = await resident(BETA);
        const id = await liveAs(d, facts, BETA, creator.token);
        touched.push({ id, hub: BETA });
        const close = d.actions.find((a) => a.name === d.deadline!.action)!;
        await reachOneOf(d, walked, BETA, id, close.from, creator.token);
        const adminToken = await admin(BETA);
        const from = (await processRow(id)).status;
        const eventsBefore = (await eventsOf(id)).length;

        // No note, or an overlong one: refused, and nothing happens.
        const bare = await act(BETA, id, close.name, {}, adminToken);
        expect(bare.status, JSON.stringify(bare.body)).toBe(400);
        expect(bare.body.code).toBe("note_required");
        const long = await act(BETA, id, close.name, { note: "x".repeat(1001) }, adminToken);
        expect(long.body.code).toBe("note_too_long");
        expect((await processRow(id)).status).toBe(from);
        expect((await eventsOf(id)).length).toBe(eventsBefore);

        // With a note: the same close as the deadline's, recorded.
        const note = `Closed early by the conformance suite, ${uniqueTitle("note")}.`;
        const closed = await act(BETA, id, close.name, { note }, adminToken);
        expect(closed.status, JSON.stringify(closed.body)).toBe(200);
        expect([...allowedTargets(close, from as ProcessStatus)]).toContain((await processRow(id)).status);
        const early = closed.body.view?.closed_early;
        expect(early?.note).toBe(note);
        expect(early?.line).toMatch(/^Closed early on .+(before the original date of .+|earlier on the original closing day)\.$/);
        for (const type of close.emits) {
          const ev = (await eventRows(id)).filter((e) => e.event_type === type);
          expect(ev, `${type} once`).toHaveLength(1);
          expect((ev[0].data as Record<string, any>).closed_early?.note, `${type} carries the note`).toBe(note);
        }
        const briefs = await briefsOf(id);
        expect(briefs).toHaveLength(d.brief ? 1 : 0);
        if (d.brief) {
          const [brief] = (await localRest(`processes?select=state&id=eq.${briefs[0].id}`)) as Array<{ state: any }>;
          expect(brief.state.content.closed_early).toEqual({ line: early.line, note });
        }
        const log = (await localRest(
          `hub_admin_audit_log?select=actor_email,after&hub_id=eq.${BETA.slug}&action=eq.process.close_early&after->>process_id=eq.${id}`,
        )) as Array<{ actor_email: string; after: { note: string } }>;
        expect(log).toHaveLength(1);
        expect(log[0].actor_email).toBe(BETA.adminEmail);
        expect(log[0].after.note).toBe(note);

        // Regenerate: the unpublished brief is made again; the text it
        // replaced is kept, and the early close is still on it.
        if (d.brief) {
          const again = await call("POST", `/admin/briefs/${briefs[0].id}/regenerate`, BETA.host, {}, adminToken);
          expect(again.status, JSON.stringify(again.body)).toBe(200);
          expect(again.body.staged).toBe(false);
          expect(again.body.brief.history).toHaveLength(1);
          expect(again.body.brief.content.closed_early).toEqual({ line: early.line, note });
        }
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

    // An archived one whose window passed still finishes (2026-10-14): on
    // production two archived votes kept their pre-2026-10-10 bridge rows,
    // which link voters to receipts, because archiving skips the close. The
    // hourly job clears them and the process stays archived.
    if (d.deadline && d.tables.includes("active_vote_keys")) {
      it("an expired, archived one ends with no key rows and stays archived", async () => {
        const id = await liveProcess(d, facts, BETA);
        touched.push({ id, hub: BETA });
        const voter = await resident(BETA);
        const [user] = (await localRest(`users?select=id&hub_id=eq.${BETA.slug}&email=eq.${encodeURIComponent(voter.email)}`)) as Array<{ id: string }>;
        await localRest("active_vote_keys", {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, process_id: id, receipt_id: `legacy-${uniqueTitle("r")}`, hub_id: BETA.slug }),
        });
        const adminToken = await admin(BETA);
        const archived = await call("POST", `/admin/processes/${id}/archive`, BETA.host, { reason: "Conformance" }, adminToken);
        expect(archived.status, JSON.stringify(archived.body)).toBe(200);
        await expireDeadline(d, id);

        const job = JOBS.find((j) => j.id === "vote_close")!;
        const cron = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
        const res = await call("GET", `${JOBS_MOUNT}${job.path}?hub=${BETA.slug}`, BETA.host, undefined, cron);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.hubs[BETA.slug].archived_finished).toContain(id);
        expect(await localRest(`active_vote_keys?process_id=eq.${id}`)).toEqual([]);
        expect((await processRow(id)).status).toBe("archived");
      }, 60_000);
    }
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

    it("its published ids survive a hub move: every identifier is read from the stored row", async () => {
      // ADR-008. The type's stored events, serialized as the hub serves them
      // (admin, member, public), must come out byte-identical when the hub
      // they belong to has moved to another hostname, and every row must
      // carry the hostname its ids were minted on.
      expect(touched.length).toBeGreaterThan(0);
      for (const { id, hub } of touched) {
        const rows = await eventRowsOf(id);
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.wire_hostname, `${r.id} has no wire hostname`).toBeTruthy();
          expect(r.wire_process_hostname, `${r.id} has no process hostname`).toBeTruthy();
        }
        const registry = await hubRow(hub.slug);
        const events = rows.map(rowToEvent);
        const serve = (at: typeof registry) =>
          withHubScope(at, {}, async () =>
            JSON.stringify(events.map((e) => [toActivity(e), toRedactedActivity(e, new Set(), "member"), toRedactedActivity(e, new Set(), "public")])),
          );
        const here = await serve(registry);
        const moved = await serve({ ...registry, hostname: `moved-${registry.hostname}` });
        expect(moved, `${d.type}: an id changed when the hub moved`).toBe(here);
        expect(moved).not.toContain(`moved-${registry.hostname}`);
      }
    });

    it("every payload field it serves a member or the public is one its manifest declares", async () => {
      // Architecture 3, ADR-010: hub:payload on the member/public wire is the
      // type's declared public shape and nothing else. The admin view is the
      // stored payload and is not checked here.
      expect(touched.length).toBeGreaterThan(0);
      for (const { id, hub } of touched) {
        const rows = await eventRowsOf(id);
        const registry = await hubRow(hub.slug);
        const events = rows.map(rowToEvent);
        await withHubScope(registry, {}, async () => {
          for (const e of events) {
            const allowed = publicPayloadKeys(e.event_type, d.type);
            for (const audience of ["member", "public"] as const) {
              const doc = toRedactedActivity(e, new Set(), audience);
              const object = doc.object as Record<string, unknown> | undefined;
              const payload = object?.["hub:payload"] as Record<string, unknown> | undefined;
              for (const key of Object.keys(payload ?? {})) {
                expect(
                  allowed.has(key),
                  `${d.type}: ${e.event_type} serves undeclared payload field "${key}" to a ${audience} reader`,
                ).toBe(true);
              }
            }
          }
        });
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

  sdkSurfaceSteps(d, facts, touched);
  for (const service of d.outside_services) tierThree(d, facts, service, touched);
}

/**
 * Steps 11 to 17 (engine 2, ADR-017): what SDK v1 promises a package beyond
 * the walk, each checked where the type uses it and skipped, named, where it
 * does not. kit/conformance/fixtures/sdk-tour uses every one, through the SDK
 * alone.
 */
function sdkSurfaceSteps(d: ProcessTypeDescriptor, facts: HostFacts, touched: Array<{ id: string; hub: Hub }>): void {
  const manifest = getManifest(d.type);

  describe("11. edits through the hub's edit path", () => {
    it("the creator edits a live one: flagged text is refused and nothing changes; a clean edit is applied and recorded; a stranger may not", async () => {
      if (!d.creation.resident) return;
      const { token } = await resident(DEMO);
      const id = await liveAs(d, facts, DEMO, token);
      touched.push({ id, hub: DEMO });
      const policy = await call("GET", `/process/${id}/edit-policy`, DEMO.host, undefined, token);
      expect(policy.status).toBe(200);
      if (!policy.body.editable) return; // this type is not edited once live
      const stranger = await resident(DEMO);
      expect((await call("GET", `/process/${id}/edit-policy`, DEMO.host, undefined, stranger.token)).body.editable).toBe(false);
      expect((await call("POST", `/process/${id}/edit`, DEMO.host, {}, stranger.token)).status).toBe(403);

      const started = await call("POST", `/process/${id}/edit`, DEMO.host, {}, token);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const draftId = started.body.draft_id as string;
      const path = d.creation.resident.drafts;
      const before = (await call("GET", `/process/${id}/state`, DEMO.host)).body;
      const renamed = uniqueTitle("Edited");

      await call("PATCH", `${path}/${draftId}`, DEMO.host, { title: renamed, description: `Edited ${FAKE_COC_FLAG}` }, token);
      const flagged = await call("POST", `${path}/${draftId}/submit`, DEMO.host, { edit_process_id: id }, token);
      expect(flagged.status, JSON.stringify(flagged.body)).toBe(400);
      expect((await call("GET", `/process/${id}/state`, DEMO.host)).body.title).toBe(before.title);

      await call("PATCH", `${path}/${draftId}`, DEMO.host, { title: renamed, description: "Edited, cleanly." }, token);
      const applied = await call("POST", `${path}/${draftId}/submit`, DEMO.host, { edit_process_id: id }, token);
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      expect((await call("GET", `/process/${id}/state`, DEMO.host)).body.title).toBe(renamed);
      expect((await eventsOf(id)).map((e) => e.event_type)).toContain("civic.process.updated");
    });
  });

  describe("12. a retry-safe action", () => {
    // Retry-safe means executeAction may run it again on a fresh read when
    // another write landed in between, so its every other effect waits for
    // the commit (afterActionCommits): however its calls interleave, its
    // events are written once per call that won.
    const retrySafe = d.actions.filter((x) => x.retry_safe && x.callers.includes("resident"));
    if (retrySafe.length === 0) it.skip("none of its resident actions is declared retry-safe", () => {});
    for (const a of retrySafe) {
      it(`${a.name}: two calls at once by one person write its events once`, async () => {
        const { token } = await resident(DEMO);
        const id = await liveAs(d, facts, DEMO, token);
        touched.push({ id, hub: DEMO });
        const payload = examplePayload(d, a.name, await processRow(id));
        await Promise.all([act(DEMO, id, a.name, payload, token), act(DEMO, id, a.name, payload, token)]);
        const written = (await eventsOf(id)).filter((e) => a.emits.includes(e.event_type));
        expect(written.length, `${a.name} wrote ${written.length} events for one person`).toBeLessThanOrEqual(a.emits.length);
      });
    }
  });

  describe("13. names under the disclosure policy", () => {
    it("names go to whom the type's policy says, never an account", async () => {
      // The engine is asked in this process (the SDK's namesFor), on the local stack.
      const stack = localStack();
      process.env.SUPABASE_URL ||= stack.url;
      process.env.SUPABASE_SERVICE_ROLE_KEY ||= stack.key;
      const { token } = await resident(DEMO);
      const id = await liveAs(d, facts, DEMO, token);
      touched.push({ id, hub: DEMO });
      const row = await processRow(id);
      const creator = row.created_by!;
      const policy = disclosurePolicyOf({ definition: { type: d.type, version: "1" }, state: row.state } as never);
      const asked = (t?: string) =>
        withHubScope(hubRowCache(DEMO.slug), {}, () =>
          namesFor({ headers: t ? { authorization: `Bearer ${t}` } : {} } as never, id, [creator]),
        ) as Promise<string[] | null>;
      const adminNames = await asked(await admin(DEMO));
      expect(adminNames).toHaveLength(1);
      expect(adminNames![0]).not.toBe(creator);
      const publicNames = await asked();
      expect(publicNames === null).toBe(!namesShown(policy, { signedIn: false, admin: false }));
      const member = await resident(DEMO);
      const memberNames = await asked(member.token);
      expect(memberNames === null).toBe(!namesShown(policy, { signedIn: true, admin: false }));
      for (const names of [publicNames, memberNames]) if (names) expect(names).not.toContain(creator);
    });
  });

  describe("14. statuses of its own", () => {
    it("every process it walked reads a declared status that is a case of its hub status", async () => {
      if (!manifest?.statuses) return;
      for (const { id } of touched) {
        const row = await processRow(id);
        if (row.type !== d.type || !["active", "closed", "finalized", "proposed", "threshold_met"].includes(row.status)) continue;
        const status = typeStatusOf(manifest, { status: row.status as ProcessStatus, state: row.state });
        expect(status, `${id} (${row.status}) reads no declared status`).toBeTruthy();
        const declared = manifest.statuses.declared.find((x) => x.id === status!.id)!;
        expect(declared.hub, `${status!.id} is declared a case of ${declared.hub}, the process is ${row.status}`).toBe(row.status);
        const state = await call("GET", `/process/${id}/state`, DEMO.host);
        if (state.status === 200) expect(state.body.type_status).toEqual(status);
      }
    });
  });

  describe("15. its own card kind", () => {
    it("a declared kind has its colour family, its stylesheet rules and its digest section, and its cards are of it", async () => {
      for (const k of manifest?.feed?.kinds ?? []) {
        expect(DECLARED_FEED_KINDS.get(k.kind)?.type).toBe(d.type);
        expect(THEME_TYPE_KEYS).toContain(k.color.key);
        expect(declaredTypeStylesheet()).toContain(`.feed-pill--type-${k.color.key}{`);
      }
      // The cards its events make wear its kinds, never another package's.
      for (const { id } of touched) {
        for (const row of await eventRowsOf(id)) {
          const kind = classifyActivity(rowToEvent(row) as never)?.kind;
          const declaredBy = kind ? DECLARED_FEED_KINDS.get(kind)?.type : undefined;
          if (declaredBy) expect(declaredBy, `${row.event_type} wears ${kind}, another type's kind`).toBe(d.type);
        }
      }
    });
  });

  describe("17. its pages on the hub's UI kit", () => {
    it("a package that draws its own pages draws them with @civic-social/plugin-sdk/ui, and never sets -ink text on a primary fill", () => {
      const pkg = loadedPackages().find((p) => p.type === d.type);
      if (!pkg) return;
      const dir = resolve(HOST_ROOT, pkg.dir);
      const ui = existsSync(join(dir, "ui.tsx")) ? readFileSync(join(dir, "ui.tsx"), "utf8") : "";
      // The hub's own packages draw the hub's own pages (ui/src/pages); a
      // package on SDK v1 draws its own, with the kit.
      const ownPages = /routes:\s*\[/.test(ui) && !/from\s+["'](\.\.\/)+ui\/src\//.test(ui);
      if (ownPages) {
        expect(ui, `${d.type}: its pages import nothing from @civic-social/plugin-sdk/ui`).toMatch(
          /import\s*\{[^}]*\b(Button|Field|TextInput|TextArea|Select|DateTimeInput|DraftShell)\b[^}]*\}\s*from\s*["']@civic-social\/plugin-sdk\/ui["']/,
        );
      }
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
        expect(inkOnPrimary(readFileSync(join(dir, f), "utf8")), `${d.type}: ${f}`).toEqual([]);
      }
    });
  });

  describe("16. the official caller", () => {
    it("an action open to officials: an official may call it, a resident may not; officials' submissions skip the wait where declared", async () => {
      const forOfficials = d.actions.filter((x) => (x.callers as readonly string[]).includes("official") && !x.callers.includes("resident"));
      const atOnce = d.creation.resident?.publish_at_once?.includes("official");
      if (forOfficials.length === 0 && !atOnce) return;
      const official = await resident(BETA);
      const officialId = await accountIdOf(BETA.host, official.token);
      await localRest(`users?id=eq.${officialId}`, {
        method: "PATCH",
        body: JSON.stringify({ official_type: "town_council", official_title: "Council member" }),
      });
      const plain = await resident(BETA);
      if (atOnce) {
        const s = await submitDraft(d, facts, BETA, official.token, { check: "passed" });
        expect(s.status, JSON.stringify(s.body)).toBe(201);
        expect(s.body.auto_approved, "an official's submission on a beta hub goes live at once").toBe(true);
        touched.push({ id: s.processId, hub: BETA });
        const r = await submitDraft(d, facts, BETA, plain.token, { check: "passed" });
        expect(r.body.auto_approved).toBe(false);
      }
      for (const a of forOfficials) {
        const id = await liveProcess(d, facts, BETA);
        touched.push({ id, hub: BETA });
        const payload = examplePayload(d, a.name, await processRow(id));
        expect((await act(BETA, id, a.name, payload, plain.token)).status).toBe(403);
        const ok = await act(BETA, id, a.name, payload, official.token);
        expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
      }
    });
  });

  describe("19. telling people", () => {
    it("a package that calls notify names mail in its grant (the hub refuses it otherwise, and the Plugins page says it sends email)", () => {
      const pkg = loadedPackages().find((p) => p.type === d.type);
      if (!pkg) return;
      const dir = resolve(HOST_ROOT, pkg.dir);
      const calls = readdirSync(dir)
        .filter((f) => /\.tsx?$/.test(f))
        .some((f) => /\bnotify\s*\(/.test(readFileSync(join(dir, f), "utf8")));
      if (calls) expect(manifest?.capabilities.adapters, `${d.type}: it calls notify`).toContain("mail");
    });
  });

  describe("20. the hub in scope", () => {
    it("its own code names no time zone and no hub's address: it takes the hub's from hubContext() (one package, every hub)", () => {
      const pkg = loadedPackages().find((p) => p.type === d.type);
      if (!pkg) return;
      const dir = resolve(HOST_ROOT, pkg.dir);
      const zone = /\b(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Z][A-Za-z_]+/;
      const hubAddress = /\b[a-z0-9-]+\.(civic\.social|localhost)\b/;
      for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
        const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
        expect(src.match(zone)?.[0], `${d.type}: ${f} names a time zone`).toBeUndefined();
        expect(src.match(hubAddress)?.[0], `${d.type}: ${f} names a hub's address`).toBeUndefined();
      }
    });
  });

  describe("18. images its residents attach", () => {
    it("a type that declares uploads takes an image from a resident under its own prefix; signed out, switched off or undeclared, it is refused", async () => {
      const path = `/upload/process-image/${encodeURIComponent(d.type)}`;
      const image = pngOf(400, 300);
      const someone = await resident(BETA);
      if (!manifest?.uploads?.images) {
        // The route is not this type's: refused as an unknown route.
        expect((await callUpload(path, BETA.host, image, "image/png", someone.token)).status).toBe(404);
        return;
      }
      expect(manifest.capabilities.adapters, `${d.type}: uploads need the objectStore adapter in its grant`).toContain("objectStore");
      const ok = await callUpload(path, BETA.host, image, "image/png", someone.token);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body).toMatchObject({ width: 400, height: 300, mime: "image/png" });
      expect(String(ok.body.url), "stored under the hub's prefix, in the type's own folder").toContain(`/${BETA.slug}/types/${d.type}/`);
      expect((await callUpload(path, BETA.host, image, "image/png")).status, "signed out").toBe(401);
      expect((await callUpload(path, BETA.host, Buffer.from("not an image"), "image/png", someone.token)).status, "not an image").toBe(400);
      await setPlugin(BETA, d.plugin, false);
      try {
        expect((await callUpload(path, BETA.host, image, "image/png", someone.token)).status, "plugin off").toBe(404);
      } finally {
        await setPlugin(BETA, d.plugin, true);
      }
    });
  });
}

/** Step 17's rule: a stylesheet rule that fills with the primary colour sets its text with -text, never -ink. */
function inkOnPrimary(css: string): string[] {
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/background(-color)?\s*:\s*var\(--color-primary\)/.test(m[2]) && /(^|;|\s)color\s*:\s*var\(--color-primary-ink/.test(m[2])) out.push(m[1].trim());
  }
  return out;
}

const hubRows = new Map<string, unknown>();
/** A hub's row, read once, for the steps that ask the engine in this process. */
function hubRowCache(slug: string): never {
  return hubRows.get(slug) as never;
}
beforeAll(async () => {
  for (const hub of [BETA, DEMO]) hubRows.set(hub.slug, await hubRow(hub.slug));
});

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
      expect((await act(BETA, id, close.name, examplePayload(d, close.name, await processRow(id)), await admin(BETA))).status).toBeLessThan(300);
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
            // The hub drives the deadline itself (§10a.3): the hourly job
            // closes it (two overlapping runs), not a read.
            await expireDeadline(d, id);
            const job = JOBS.find((j) => j.id === "vote_close")!;
            const cron = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
            await Promise.all(
              Array.from({ length: 2 }, () => call("GET", `${JOBS_MOUNT}${job.path}?hub=${BETA.slug}`, BETA.host, undefined, cron)),
            );
          } else {
            const res = await act(BETA, id, close.name, examplePayload(d, close.name, await processRow(id)), await admin(BETA));
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

/** A process's events with their data (eventsOf leaves data out). */
async function eventRows(processId: string): Promise<Array<{ event_type: string; data: unknown }>> {
  return (await localRest(`events?select=event_type,data&process_id=eq.${processId}`)) as Array<{ event_type: string; data: unknown }>;
}
