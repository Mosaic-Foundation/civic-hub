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
 * NOT RUN IN CI (see TESTING.md "Running integration tests in CI" — CI
 * has no database and no server). Run locally with the dev server up:
 *   npx vitest run tests/api/publicAnonymity.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  api,
  apiJson,
  getResidentToken,
  authHeaders,
} from "../fixtures/helpers.js";
import { mintSession } from "../fixtures/adminSession.js";

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
    authorToken = await getResidentToken();
    commenterToken = await getResidentToken();
    // getResidentToken names everyone "Test Resident"; give the two
    // accounts distinct names so a leak is unambiguous.
    await api("/auth/me", {
      method: "PATCH",
      headers: authHeaders(authorToken),
      body: JSON.stringify({ full_name: AUTHOR_NAME }),
    });
    await api("/auth/me", {
      method: "PATCH",
      headers: authHeaders(commenterToken),
      body: JSON.stringify({ full_name: COMMENTER_NAME }),
    });

    const { body } = await apiJson<{ id: string }>("/proposals", {
      method: "POST",
      headers: authHeaders(authorToken),
      body: JSON.stringify({
        title: `Anonymity integration ${Date.now()}`,
        description: "public-anonymity integration fixture",
      }),
    });
    proposalId = body.id;

    await api(`/process/${proposalId}/input`, {
      method: "POST",
      headers: authHeaders(commenterToken),
      body: JSON.stringify({ body: "A comment from the second resident." }),
    });
  });

  it("unauthenticated detail is redacted to Resident 1", async () => {
    const { status, body } = await apiJson<CreatorFields>(
      `/proposals/${proposalId}`,
    );
    expect(status).toBe(200);
    expect(body.creator_name).toBe("Resident 1");
    expect(body.creator_is_admin).toBe(false);
    expect(body.submitted_by).toBe("");
    expect(JSON.stringify(body)).not.toContain(AUTHOR_NAME);
  });

  it("unauthenticated comments are numbered from the same map", async () => {
    const { body } = await apiJson<CommentRow[]>(
      `/process/${proposalId}/input`,
    );
    const comment = body.find((c) =>
      c.body.includes("second resident"),
    );
    expect(comment?.author_name).toBe("Resident 2");
    expect(comment?.author_is_admin).toBe(false);
    expect(comment?.author_id).toBe("");
    expect(JSON.stringify(body)).not.toContain(COMMENTER_NAME);
  });

  it("a signed-in request to the same endpoints returns real names", async () => {
    const detail = await apiJson<CreatorFields>(`/proposals/${proposalId}`, {
      headers: authHeaders(commenterToken),
    });
    expect(detail.body.creator_name).toBe(AUTHOR_NAME);

    const comments = await apiJson<CommentRow[]>(
      `/process/${proposalId}/input`,
      { headers: authHeaders(commenterToken) },
    );
    const comment = comments.body.find((c) =>
      c.body.includes("second resident"),
    );
    expect(comment?.author_name).toBe(COMMENTER_NAME);
  });

  it("unauthenticated /events carries no raw resident actor for this process", async () => {
    const { body } = await apiJson<{ orderedItems: { actor: string }[] }>(
      `/events?context=${proposalId}&page=true`,
    );
    for (const item of body.orderedItems) {
      expect(item.actor).not.toMatch(/\/users\/user_/);
    }
  });

  it("signed-in /events hides account ids from a resident, not from an admin (audit C2)", async () => {
    const asResident = await apiJson<{ orderedItems: { actor: string }[] }>(
      `/events?context=${proposalId}&page=true`,
      { headers: authHeaders(commenterToken) },
    );
    expect(asResident.body.orderedItems.length).toBeGreaterThan(0);
    expect(JSON.stringify(asResident.body)).not.toContain("/users/user_");
    // The bare test host is the demo hub; its admin keeps the canonical IRIs.
    const admin = await mintSession("athens", "admin+athens@example.test");
    const asAdmin = await apiJson<{ orderedItems: { actor: string }[] }>(
      `/events?context=${proposalId}&page=true`,
      { headers: authHeaders(admin) },
    );
    expect(
      asAdmin.body.orderedItems.some((i) => i.actor.includes("/users/user_")),
    ).toBe(true);
  });

  it("unauthenticated /api/feed carries neither name", async () => {
    const { body } = await apiJson<unknown>(`/api/feed`);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(AUTHOR_NAME);
    expect(raw).not.toContain(COMMENTER_NAME);
  });
});
