// Audit 2, A6 (2026-10-11): limits on the paid AI calls a hub's people make.
//
// On a demo hub the console creates for this file (archived in afterAll):
// the console shows and sets the limits; the message cap; the per-person
// hourly count; the hub's daily token budget; and a hub admin cannot set the
// limits from the hub's own Settings.
//
// The test servers run with the in-memory AI (CIVIC_FAKE_ADAPTERS, ADR-012),
// so a chat turn that is let through is answered by the fake after it was
// counted, and no paid call is ever made here.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const SLUG = `ail-${run}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `ail-admin-${run}@example.test`;
let cookie = "";

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function resident(name: string): Promise<{ token: string; draft: string }> {
  const token = await mintSession(SLUG, `${name}-${run}@example.test`);
  const draft = await call("POST", "/votes/drafts", HOST, {}, token);
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  return { token, draft: draft.body.id as string };
}

const message = (draft: string) => `/assistant/civic.vote/drafts/${draft}/message`;

beforeAll(async () => {
  cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug: SLUG, name: "AI Limits Hub", hostname: HOST, admin_email: ADMIN, hub_kind: "organization" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
});

afterAll(async () => {
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie, body: { step_up_code: await stepCode() } });
});

describe("the console sets a hub's AI limits", () => {
  it("shows a demo hub's defaults: a smaller budget and no web search", async () => {
    const res = await consoleCall("GET", `/control/hubs/${SLUG}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.ai_limits.defaults).toMatchObject({ daily_tokens: 300_000, job_daily_tokens: 500_000, web_search: false, user_per_hour: 20, max_message_chars: 4000 });
    expect(res.body.ai_limits.overrides).toEqual({});
  });

  it("stores only what differs, refuses nonsense, and puts a field back with null", async () => {
    const bad = await consoleCall("PUT", `/control/hubs/${SLUG}/ai-limits`, { cookie, body: { user_per_hour: -1 } });
    expect(bad.status).toBe(400);
    expect((await consoleCall("PUT", `/control/hubs/${SLUG}/ai-limits`, { cookie, body: { surprise: 3 } })).status).toBe(400);

    const set = await consoleCall("PUT", `/control/hubs/${SLUG}/ai-limits`, {
      cookie,
      body: { user_per_hour: 2, web_search: true, daily_tokens: 300_000 },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.ai_limits.overrides).toEqual({ user_per_hour: 2, web_search: true });
    expect(set.body.ai_limits.effective.user_per_hour).toBe(2);

    const back = await consoleCall("PUT", `/control/hubs/${SLUG}/ai-limits`, { cookie, body: { web_search: null } });
    expect(back.body.ai_limits.overrides).toEqual({ user_per_hour: 2 });

    const audit = await consoleCall("GET", `/control/audit?hub=${SLUG}`, { cookie });
    expect(JSON.stringify(audit.body)).toContain("hub.ai_limits");
  });

  it("a hub admin cannot set them from the hub's Settings", async () => {
    const admin = await mintSession(SLUG, ADMIN);
    const before = await storedSetting(SLUG, "limits.ai");
    await call("PUT", "/admin/hub/settings", HOST, { section: "identity", values: { "limits.ai": "{}" } }, admin);
    expect(await storedSetting(SLUG, "limits.ai")).toBe(before);
  });
});

describe("the hub enforces them", () => {
  it("refuses a message over the length cap before anything is counted or sent", async () => {
    const { token, draft } = await resident("long");
    const res = await call("POST", message(draft), HOST, { phase: "free_form", user_message: "x".repeat(4001) }, token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("message_too_long");
  });

  it("counts a person's turns: the third in an hour is refused (limit set to 2 above)", async () => {
    const { token, draft } = await resident("busy");
    for (let i = 0; i < 2; i++) {
      const r = await call("POST", message(draft), HOST, { phase: "free_form", user_message: "hello" }, token);
      expect(r.status, JSON.stringify(r.body)).not.toBe(429);
      // Let through and counted; the server's AI is the in-memory fake
      // (CIVIC_FAKE_ADAPTERS, ADR-012), which answers. The not-set-up answer
      // is tests/unit/aiGate.test.ts.
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const refused = await call("POST", message(draft), HOST, { phase: "free_form", user_message: "hello" }, token);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("ai_rate_limited");
    // Suggestions count in the same hour.
    expect((await call("POST", `/assistant/civic.vote/drafts/${draft}/suggest`, HOST, {}, token)).status).toBe(429);
  });

  it("pauses the assistant when the hub's tokens for the day are spent; the check falls back to an admin", async () => {
    const { token, draft } = await resident("budget");
    await localRest("ai_usage", {
      method: "POST",
      body: JSON.stringify({ hub_id: SLUG, purpose: "assistant.message", model: "test", input_tokens: 300_000, output_tokens: 0 }),
    });
    const res = await call("POST", message(draft), HOST, { phase: "free_form", user_message: "hello" }, token);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("ai_budget_spent");

    // Submit runs the check; with the budget spent it can't, and the
    // submission goes to an admin instead (fail open to human review).
    await call("PATCH", `/votes/drafts/${draft}`, HOST, { title: `Budget spent ${run}`, description: "Checked at Submit." }, token);
    const submitted = await call("POST", `/votes/drafts/${draft}/submit`, HOST, {}, token);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const [review] = (await localRest(`process_reviews?select=status&id=eq.${submitted.body.review_id}`)) as Array<{ status: string }>;
    expect(review.status).toBe("pending_review");
  });
});
