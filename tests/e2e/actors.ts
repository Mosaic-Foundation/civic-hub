/**
 * Who acts in an E2E spec, and the live processes they act on, made through
 * the hub's API (Actions slice, 2026-10-13). Shared so each spec doesn't
 * carry its own copy.
 *
 * Playwright's transpiler can't load fixtures that import `src/` modules
 * with side effects (the registry), so this file reaches the hub only over
 * HTTP and the local stack's REST.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { FAKE_COC_DOWN } from "../../src/debug/fakeCodeOfConduct.js";
import { E2E_API_BASE as API } from "./hubApi";

export const run = Date.now().toString(36);

export async function hubId(request: APIRequestContext): Promise<string> {
  return ((await (await request.get(`${API}/hub-config`)).json()) as { hub: { id: string } }).hub.id;
}

export function adminEmailFor(hub: string): string {
  return hub === "floyd" ? "admin@example.test" : `admin+${hub}@example.test`;
}

/** A session whose account has accepted the current terms (else a dialog covers the page). */
export async function session(hub: string, email: string): Promise<{ token: string; userId: string }> {
  const token = await mintSession(hub, email);
  const filter = `users?hub_id=eq.${hub}&email=eq.${encodeURIComponent(email)}`;
  await localRest(filter, { method: "PATCH", body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }) });
  const [u] = (await localRest(`${filter}&select=id`)) as Array<{ id: string }>;
  return { token, userId: u.id };
}

/** Open pages as this session, with the first-visit popups dismissed. */
export async function visitAs(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** An active vote an admin made, open for a day. */
export async function liveVote(
  request: APIRequestContext,
  adminToken: string,
  title: string,
  state: Record<string, unknown> = {},
): Promise<string> {
  const created = await request.post(`${API}/process`, {
    headers: auth(adminToken),
    data: {
      definition: { type: "civic.vote", version: "0.1" },
      title,
      description: "A vote made by an end-to-end test.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct", ...state },
    },
  });
  if (created.status() !== 201) throw new Error(`vote create: ${created.status()} ${await created.text()}`);
  const id = (await created.json()).id as string;
  const act = await request.post(`${API}/process/${id}/action`, {
    headers: auth(adminToken),
    data: { type: "process.activate", payload: {} },
  });
  if (!act.ok()) throw new Error(`vote activate: ${act.status()} ${await act.text()}`);
  return id;
}

/**
 * A live proposal: a resident's draft, held for an admin (the fake Code of
 * Conduct check is down on its marker), approved by the admin.
 */
export async function liveProposal(
  request: APIRequestContext,
  residentToken: string,
  adminToken: string,
  title: string,
): Promise<string> {
  const draft = await (await request.post(`${API}/proposals/drafts`, { headers: auth(residentToken), data: { category: "idea" } })).json();
  await request.patch(`${API}/proposals/drafts/${draft.id}`, {
    headers: auth(residentToken),
    data: { title, description: `A proposal made by an end-to-end test. ${FAKE_COC_DOWN}` },
  });
  const submitted = await request.post(`${API}/proposals/drafts/${draft.id}/submit`, { headers: auth(residentToken), data: {} });
  if (submitted.status() !== 201) throw new Error(`proposal submit: ${submitted.status()} ${await submitted.text()}`);
  const { review_id, process_id } = await submitted.json();
  const approved = await request.post(`${API}/admin/reviews/${review_id}/approve`, { headers: auth(adminToken), data: {} });
  if (!approved.ok()) throw new Error(`proposal approve: ${approved.status()} ${await approved.text()}`);
  return process_id as string;
}

/** Close a process as an admin (before its deadline that takes a note). */
export async function closeAsAdmin(
  request: APIRequestContext,
  adminToken: string,
  id: string,
  type = "process.close",
  note = "Closed by an end-to-end test's cleanup.",
): Promise<void> {
  await request.post(`${API}/process/${id}/action`, { headers: auth(adminToken), data: { type, payload: { note } } });
}
