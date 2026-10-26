// Regenerate a brief (Actions slice, 2026-10-13). The conformance suite makes
// every type's unpublished brief again (step 5b). This file walks a
// published one: the new version is staged, the published brief is unchanged
// until an admin publishes it, then its page and its one feed card show the
// new version, marked updated; nobody is emailed again; the old versions are
// kept; the admin log records who regenerated and who published.

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest } from "../fixtures/adminSession.js";
import { act, admin, BETA, briefsOf, liveProcess, resident } from "../../kit/conformance/src/driver.js";
import { hostFacts } from "../../kit/conformance/src/hostFacts.js";
import { getDescriptor } from "../../src/processes/registry.js";

let adminToken = "";
let voteId = "";
let briefId = "";

async function auditRows(action: string): Promise<Array<{ actor_email: string; after: Record<string, unknown> }>> {
  return (await localRest(
    `hub_admin_audit_log?select=actor_email,after&hub_id=eq.${BETA.slug}&action=eq.${action}&after->>brief_id=eq.${briefId}`,
  )) as Array<{ actor_email: string; after: Record<string, unknown> }>;
}

beforeAll(async () => {
  adminToken = await admin(BETA);
  const made = await call("POST", "/process", BETA.host, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Regenerate ${Date.now()}`,
    description: "A vote for the regenerate test.",
    state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
  }, adminToken);
  voteId = made.body.id;
  await act(BETA, voteId, "process.activate", {}, adminToken);
  await act(BETA, voteId, "process.vote", { option: "Yes" }, (await resident(BETA)).token);
  const closed = await act(BETA, voteId, "process.close", { note: "Settled at the meeting." }, adminToken);
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  [{ id: briefId }] = await briefsOf(voteId);
  // Publish it with nobody to email.
  expect((await call("PATCH", `/admin/briefs/${briefId}`, BETA.host, { recipients: [] }, adminToken)).status).toBe(200);
  const approved = await call("POST", `/admin/briefs/${briefId}/approve`, BETA.host, {}, adminToken);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
});

describe("Regenerate a published brief", () => {
  it("a resident can't", async () => {
    const res = await call("POST", `/admin/briefs/${briefId}/regenerate`, BETA.host, {}, (await resident(BETA)).token);
    expect(res.status).toBe(403);
  });

  it("stages a new version; the published brief is unchanged until it is published", async () => {
    expect((await call("GET", `/brief/${briefId}`, BETA.host)).status).toBe(200);
    // Stand in for a poor published text, so the new version differs.
    await localRest(`processes?id=eq.${briefId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...(await stateOf(briefId)), content: { ...(await stateOf(briefId)).content, headline: "An old headline" } } }),
    });

    const res = await call("POST", `/admin/briefs/${briefId}/regenerate`, BETA.host, {}, adminToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.staged).toBe(true);
    expect(res.body.brief.pending_revision.content.headline).not.toBe("An old headline");
    expect(res.body.brief.pending_revision.content.closed_early.note).toBe("Settled at the meeting.");

    const still = await call("GET", `/brief/${briefId}`, BETA.host);
    expect(still.body.headline).toBe("An old headline");
    expect(still.body.revised_at).toBeNull();
    expect(await auditRows("brief.regenerate")).toHaveLength(1);
  });

  it("publishing it replaces the brief in place: its page, its one feed card, no email, history kept", async () => {
    const deliveredBefore = (await stateOf(briefId)).delivered_at ?? null;
    const res = await call("POST", `/admin/briefs/${briefId}/revision/publish`, BETA.host, {}, adminToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.brief.pending_revision).toBeNull();
    expect(res.body.brief.history.at(-1).content.headline).toBe("An old headline");

    const page = await call("GET", `/brief/${briefId}`, BETA.host);
    expect(page.body.headline).not.toBe("An old headline");
    expect(page.body.revised_at).toEqual(expect.any(String));
    expect((await stateOf(briefId)).delivered_at ?? null).toBe(deliveredBefore);

    // The feed as residents read it: the brief's one card (its publish event),
    // with the card data the server batches in.
    const feed = await call("GET", `/api/feed?limit=100`, BETA.host);
    const cards = feed.body.events.filter((e: { process_id: string }) => e.process_id === briefId);
    expect(cards).toHaveLength(1);
    expect(feed.body.process_meta[briefId]).toMatchObject({ description: page.body.headline, lastEditedAt: page.body.revised_at });

    const log = await auditRows("brief.revision_published");
    expect(log).toHaveLength(1);
    expect(log[0].actor_email).toBe(BETA.adminEmail);
  });

  it("nothing waiting: publish and discard say so", async () => {
    for (const path of ["revision/publish", "revision/discard"]) {
      const res = await call("POST", `/admin/briefs/${briefId}/${path}`, BETA.host, {}, adminToken);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("no_pending_revision");
    }
  });

  it("a discarded version leaves the published brief as it was", async () => {
    const headline = (await call("GET", `/brief/${briefId}`, BETA.host)).body.headline;
    expect((await call("POST", `/admin/briefs/${briefId}/regenerate`, BETA.host, {}, adminToken)).body.staged).toBe(true);
    const res = await call("POST", `/admin/briefs/${briefId}/revision/discard`, BETA.host, {}, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.brief.pending_revision).toBeNull();
    expect((await call("GET", `/brief/${briefId}`, BETA.host)).body.headline).toBe(headline);
  });
});

// The summary is the brief's (plugin session 2, ADR-015): a conversation's
// close records its result from Polis as data, the brief writes the summary
// (with the AI, under the brief's grant; the fake Polis's fake summary here),
// and the conversation's page reads it from its brief. Regenerating the brief
// makes the summary again; the page follows the brief as published.
describe("A conversation's summary, made by its brief", () => {
  const POOR = {
    summary_text: "A poor summary.",
    marker: "poor",
    directed_questions: [],
    top_consensus_statements: [],
    opinion_groups: [],
    participation_stats: { total_participants: 0, total_statements: 0, total_votes: 0, opinion_groups_formed: 0 },
    linked_polis_data_uri: "",
    methodology: { prompt_version: "old", model_used: "old", generated_at: "2026-10-01T00:00:00.000Z" },
  };

  async function closedConversation(): Promise<{ id: string; briefId: string }> {
    const d = getDescriptor("civic.polis_deliberation")!;
    const id = await liveProcess(d, hostFacts(), BETA);
    const closed = await act(BETA, id, d.deadline!.action, { note: "Wrapped up early." }, adminToken);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const [brief] = await briefsOf(id);
    expect(brief, "the close made a brief").toBeTruthy();
    return { id, briefId: brief.id };
  }

  async function pageSummary(id: string) {
    return (await call("GET", `/process/${id}/state`, BETA.host)).body.summary;
  }

  it("closing one makes its brief with the summary; the conversation keeps only the result, and its page reads the brief", async () => {
    const { id, briefId: brief } = await closedConversation();
    const conversation = await stateOf(id);
    expect(conversation.summary).toBeNull();
    expect(conversation.result).toMatchObject({ kind: "deliberation" });
    const content = (await stateOf(brief)).content;
    expect(content.source_result ?? null).toBeNull();
    expect(content.deliberation.summary_text).toMatch(/^What participants said about /);
    expect(content.summary).toBe(content.deliberation.summary_text);
    const page = await call("GET", `/process/${id}/state`, BETA.host);
    expect(page.body.summary).toEqual(content.deliberation);
    expect(page.body.summary_status).toBe("complete");
    // The conversation's own page (/deliberations/:id) too.
    expect((await call("GET", `/deliberations/${id}`, BETA.host)).body.summary).toEqual(content.deliberation);
  }, 60_000);

  it("published: regenerating stages a new summary; the page keeps the published one until it is published", async () => {
    const { id, briefId: brief } = await closedConversation();
    // Stand in for a poor summary on the brief, so the new one differs.
    const before = await stateOf(brief);
    await localRest(`processes?id=eq.${brief}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...before, content: { ...before.content, deliberation: { ...before.content.deliberation, ...POOR } } } }),
    });
    await call("PATCH", `/admin/briefs/${brief}`, BETA.host, { recipients: [] }, adminToken);
    expect((await call("POST", `/admin/briefs/${brief}/approve`, BETA.host, {}, adminToken)).status).toBe(200);
    expect((await pageSummary(id)).marker).toBe("poor");

    // The conversation's own Regenerate link is the brief's.
    const staged = await call("POST", `/deliberations/${id}/regenerate`, BETA.host, {}, adminToken);
    expect(staged.status, JSON.stringify(staged.body)).toBe(200);
    expect(staged.body.result).toEqual({ staged: true, brief_id: brief });
    expect((await pageSummary(id)).marker).toBe("poor");

    expect((await call("POST", `/admin/briefs/${brief}/revision/publish`, BETA.host, {}, adminToken)).status).toBe(200);
    const after = await pageSummary(id);
    expect(after.marker).toBeUndefined();
    expect(after).toEqual((await stateOf(brief)).content.deliberation);
    expect((await stateOf(id)).summary).toBeNull();
  }, 60_000);

  it("an older conversation (its summary on its own state) shows that until its brief is made again", async () => {
    const { id, briefId: brief } = await closedConversation();
    // As a conversation closed before the move is stored: its own summary, a brief without one.
    await localRest(`processes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ state: { ...(await stateOf(id)), summary: POOR, summary_status: "complete" } }) });
    const old = await stateOf(brief);
    const { deliberation: _gone, ...oldContent } = old.content;
    await localRest(`processes?id=eq.${brief}`, { method: "PATCH", body: JSON.stringify({ state: { ...old, content: oldContent } }) });
    expect(await pageSummary(id)).toEqual(POOR);

    const replaced = await call("POST", `/admin/briefs/${brief}/regenerate`, BETA.host, {}, adminToken);
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.staged).toBe(false);
    expect(await pageSummary(id)).toEqual((await stateOf(brief)).content.deliberation);
  }, 60_000);
});

async function stateOf(id: string): Promise<Record<string, any>> {
  const [row] = (await localRest(`processes?select=state&id=eq.${id}`)) as Array<{ state: Record<string, any> }>;
  return row.state;
}
