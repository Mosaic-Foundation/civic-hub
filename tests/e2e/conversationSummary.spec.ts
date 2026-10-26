/**
 * A conversation's summary after the move (plugin session 2, ADR-015): the
 * conversation records its result from Polis when it closes, its brief writes
 * the summary, and the conversation's page reads it from the brief. What a
 * resident sees on the page is what it was: the summary, the figures, the
 * agreement. On the fake Polis, whose summary is made without a model.
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, closeAsAdmin, hubId, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

test("a conversation that closes still shows its summary, now written by its brief", async ({ page, request }) => {
  const hub = await hubId(request);
  const admin = (await session(hub, adminEmailFor(hub))).token;
  const topic = `The river path ${run}`;
  const created = await request.post(`${API}/deliberations`, {
    headers: { Authorization: `Bearer ${admin}` },
    data: { title: topic, topic, framing: "What should the hub know?" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { id?: string; process_id?: string; process?: { id: string } });
  const processId = id.id ?? id.process_id ?? id.process!.id;

  await closeAsAdmin(request, admin, processId, "close", "Closed by the summary test.");

  // The brief has it; the conversation keeps only the result.
  const [brief] = (await localRest(
    `processes?select=state&type=eq.civic.brief&state->>source_process_id=eq.${processId}`,
  )) as Array<{ state: Record<string, any> }>;
  expect(brief?.state.content.deliberation.summary_text).toBe(`What participants said about ${topic}.`);
  const [conversation] = (await localRest(`processes?select=state&id=eq.${processId}`)) as Array<{ state: Record<string, any> }>;
  expect(conversation.state.summary).toBeNull();

  await visitAs(page, admin);
  await page.goto(`/deliberation/${processId}`);
  await expect(page.locator(".completed-summary-text")).toHaveText(`What participants said about ${topic}.`);
  await expect(page.locator(".completed-stats")).toContainText("participants");
  await expect(page.locator(".completed-methodology")).toContainText("none (fake Polis)");
});
