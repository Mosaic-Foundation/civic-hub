/**
 * Public anonymity — integration check (2026-08-31).
 *
 * Verifies against a REAL running server + database that:
 *   - an unauthenticated request to a proposal detail (and its comment
 *     thread) returns redacted "Resident N" bylines with no real names
 *     and no raw ids, numbered per-process by first appearance;
 *   - a signed-in request to the SAME endpoints returns real names
 *     (member experience unchanged);
 *   - unauthenticated /events (AS2) and /api/feed carry no raw resident
 *     actor ids, nor does a signed-in resident's (audit C2); an admin's does.
 *
 * Runs in both CI API passes (needs the local stack and a server).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { BETA } from "../conformance/driver.js";
import { liveProposal } from "../fixtures/liveProcess.js";

// On the beta hub (2026-10-12): a proposal is now made through a draft and
// review, and a visitor's submission on the demo hub is sample content, kept
// off /events by design. A beta resident's approved proposal is ordinary.
const FLOYD = BETA.host;
const get = <T,>(path: string, token?: string) =>
  call("GET", path, FLOYD, undefined, token) as Promise<{ status: number; body: T }>;

interface CreatorFields {
  creator_name?: string;
  creator_is_admin?: boolean;
  submitted_by?: string;
}
interface CommentRow {
  author_name: string | null;
  author_is_admin: boolean;
  author_id: string;
  body: string;
}

// One proposal, one author, one distinct commenter — created fresh so the
// numbering assertions are exact.
const AUTHOR_NAME = "Anonymity Author";
const COMMENTER_NAME = "Anonymity Commenter";

describe("public anonymity — proposal detail + comments", () => {
  let authorToken: string;
  let commenterToken: string;
  let proposalId: string;

  beforeAll(async () => {
    const run = Date.now().toString(36);
    authorToken = await mintSession("floyd", `anonymity-author-${run}@example.test`);
    commenterToken = await mintSession("floyd", `anonymity-commenter-${run}@example.test`);
    // Distinct names so a leak is unambiguous.
    await call("PATCH", "/auth/me", FLOYD, { full_name: AUTHOR_NAME }, authorToken);
    await call("PATCH", "/auth/me", FLOYD, { full_name: COMMENTER_NAME }, commenterToken);

    proposalId = await liveProposal(FLOYD, authorToken, `Anonymity integration ${Date.now()}`, "public-anonymity integration fixture");

    await call("POST", `/process/${proposalId}/input`, FLOYD, { body: "A comment from the second resident." }, commenterToken);
  });

  it("unauthenticated detail is redacted to Resident 1", async () => {
    const { status, body } = await get<CreatorFields>(`/proposals/${proposalId}`);
    expect(status).toBe(200);
    expect(body.creator_name).toBe("Resident 1");
    expect(body.creator_is_admin).toBe(false);
    // One read model per type (Actions slice): the creator is created_by,
    // blanked, as on every type's page; no submitted_by.
    expect((body as Record<string, unknown>).created_by).toBe("");
    expect(body.submitted_by).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(AUTHOR_NAME);
  });

  it("unauthenticated comments are numbered from the same map", async () => {
    const { body } = await get<CommentRow[]>(`/process/${proposalId}/input`);
    const comment = body.find((c) =>
      c.body.includes("second resident"),
    );
    expect(comment?.author_name).toBe("Resident 2");
    expect(comment?.author_is_admin).toBe(false);
    expect(comment?.author_id).toBe("");
    expect(JSON.stringify(body)).not.toContain(COMMENTER_NAME);
  });

  it("a signed-in request to the same endpoints returns real names", async () => {
    const detail = await get<CreatorFields>(`/proposals/${proposalId}`, commenterToken);
    expect(detail.body.creator_name).toBe(AUTHOR_NAME);

    const comments = await get<CommentRow[]>(`/process/${proposalId}/input`, commenterToken);
    const comment = comments.body.find((c) =>
      c.body.includes("second resident"),
    );
    expect(comment?.author_name).toBe(COMMENTER_NAME);
  });

  it("unauthenticated /events carries no raw resident actor for this process", async () => {
    const { body } = await get<{ orderedItems: { actor: string }[] }>(`/events?context=${proposalId}&page=true`);
    for (const item of body.orderedItems) {
      expect(item.actor).not.toMatch(/\/users\/user_/);
    }
  });

  it("signed-in /events hides account ids from a resident, not from an admin (audit C2)", async () => {
    const asResident = await get<{ orderedItems: { actor: string }[] }>(`/events?context=${proposalId}&page=true`, commenterToken);
    expect(asResident.body.orderedItems.length).toBeGreaterThan(0);
    expect(JSON.stringify(asResident.body)).not.toContain("/users/user_");
    // The hub's admin keeps the canonical IRIs.
    const admin = await mintSession("floyd", "admin@example.test");
    const asAdmin = await get<{ orderedItems: { actor: string }[] }>(`/events?context=${proposalId}&page=true`, admin);
    expect(
      asAdmin.body.orderedItems.some((i) => i.actor.includes("/users/user_")),
    ).toBe(true);
  });

  it("unauthenticated /api/feed carries neither name", async () => {
    const { body } = await get<unknown>(`/api/feed`);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(AUTHOR_NAME);
    expect(raw).not.toContain(COMMENTER_NAME);
  });
});
