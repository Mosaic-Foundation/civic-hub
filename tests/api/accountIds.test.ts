// Account ids reach only their owner and the hub's admins (Actions slice,
// 2026-10-13). Until this slice, POST /process/:id/action answered with the
// raw process row: a vote's `state.supporters` (the account id of everyone
// who endorsed it) and the creator's id went to whoever acted.
//
// One resident (the viewer) acts and reads; everyone else's account ids are
// planted first by other residents doing every resident action of every type
// and commenting. Every answer the viewer and a visitor get, from every
// action and every read of the process, must carry no account id but the
// viewer's own. The conformance suite checks the same on every action of
// every type as it walks them (runConformance.ts, step 4).

import { beforeAll, describe, expect, it } from "vitest";
import { call, type HostResponse } from "../fixtures/hostCall.js";
import { act, admin, BETA, examplePayload, liveProcess, processRow, resident } from "../../kit/conformance/src/driver.js";
import { hostFacts } from "../../kit/conformance/src/hostFacts.js";
import { localRest } from "../fixtures/adminSession.js";
import { accountIdOf, foreignIds } from "../fixtures/accountIds.js";
import { getAllHandlers } from "../../src/processes/registry.js";
import type { ProcessTypeDescriptor } from "../../src/processes/descriptor.js";

async function titleOf(id: string): Promise<string> {
  const rows = (await localRest(`processes?select=title&id=eq.${id}`)) as Array<{ title: string }>;
  return rows[0].title;
}


/** The descriptors of the types residents act on, each with a live process. */
const walked: Array<{ d: ProcessTypeDescriptor; id: string }> = [];
let viewer = "";
let viewerId = "";

/** Where a type's page reads its process, beside /process/:id/state. */
const DETAIL: Record<string, (id: string) => string> = {
  "civic.proposal": (id) => `/proposals/${id}`,
  "civic.project": (id) => `/projects/${id}`,
  "civic.polis_deliberation": (id) => `/deliberations/${id}`,
  "civic.wordcloud": (id) => `/wordcloud/${id}`,
  "civic.announcement": (id) => `/announcement/${id}`,
};

/** A type's own list page. */
const LIST: Record<string, string> = {
  "civic.proposal": "/proposals",
  "civic.project": "/projects",
  "civic.polis_deliberation": "/deliberations",
  "civic.announcement": "/announcements",
};

beforeAll(async () => {
  const facts = hostFacts();
  const descriptors = getAllHandlers()
    .map((h) => h.descriptor)
    .filter((d) => d.creation.resident || d.creation.admin);
  for (const d of descriptors) {
    const id = await liveProcess(d, facts, BETA);
    // Other residents each do one thing a resident may do here (one each, so
    // an endorsement is not undone by the same person), and comment.
    const status = (await processRow(id)).status;
    for (const a of d.actions.filter((x) => x.callers.includes("resident") && x.from.includes(status as never))) {
      const { token } = await resident(BETA);
      await act(BETA, id, a.name, examplePayload(d, a.name, await processRow(id)), token);
      await call("POST", `/process/${id}/input`, BETA.host, { body: `A comment on ${a.name}.` }, token);
    }
    walked.push({ d, id });
  }
  viewer = (await resident(BETA)).token;
  viewerId = await accountIdOf(BETA.host, viewer);
}, 180_000);

describe("no answer to a resident or a visitor carries another person's account id", () => {
  it("the answer to every resident action", async () => {
    const leaks: string[] = [];
    for (const { d, id } of walked) {
      const status = (await processRow(id)).status;
      for (const a of d.actions.filter((x) => x.callers.includes("resident") && x.from.includes(status as never))) {
        const res = await act(BETA, id, a.name, examplePayload(d, a.name, await processRow(id)), viewer);
        const ids = foreignIds(res.body, viewerId);
        if (ids.length > 0) leaks.push(`${d.type} ${a.name}: ${ids.join(", ")}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it("every read of the process, for a resident and for a visitor", async () => {
    const leaks: string[] = [];
    for (const { d, id } of walked) {
      const paths = [
        `/process/${id}/state`,
        `/process/${id}`,
        `/process?type=${d.type}`,
        `/process/${id}/input`,
        `/events?context=${id}&page=true`,
        `/api/feed?process_id=${id}`,
        ...(DETAIL[d.type] ? [DETAIL[d.type](id)] : []),
        ...(LIST[d.type] ? [LIST[d.type]] : []),
        `/search?q=${encodeURIComponent(await titleOf(id))}`,
      ];
      for (const [who, token, own] of [["resident", viewer, viewerId], ["visitor", undefined, null]] as const) {
        for (const path of paths) {
          const res: HostResponse = await call("GET", path, BETA.host, undefined, token);
          const ids = foreignIds(res.body, own);
          if (ids.length > 0) leaks.push(`${who} GET ${path.replace(id, ":id")} [${d.type}]: ${ids.join(", ")}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it("an admin still sees account ids where the admin pages need them", async () => {
    const vote = walked.find((w) => w.d.type === "civic.vote")!;
    const page = await call("GET", `/events?context=${vote.id}&page=true`, BETA.host, undefined, await admin(BETA));
    expect(foreignIds(page.body, null).length).toBeGreaterThan(0);
  });
});
