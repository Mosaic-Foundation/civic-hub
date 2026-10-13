// Regenerate a brief (Actions slice, 2026-10-13). The conformance suite makes
// every type's unpublished brief again (step 5b). This file walks a
// published one: the new version is staged, the published brief is unchanged
// until an admin publishes it, then its page and its one feed card show the
// new version, marked updated; nobody is emailed again; the old versions are
// kept; the admin log records who regenerated and who published.

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest } from "../fixtures/adminSession.js";
import { act, admin, BETA, briefsOf, resident } from "../conformance/driver.js";

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

async function stateOf(id: string): Promise<Record<string, any>> {
  const [row] = (await localRest(`processes?select=state&id=eq.${id}`)) as Array<{ state: Record<string, any> }>;
  return row.state;
}
