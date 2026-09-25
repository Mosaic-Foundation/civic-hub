// Phase 2c: an event created on Athens is stored with Athens's own origin in
// source.hub_url and action_url, and one created on Floyd with Floyd's — the
// same server, the same BASE_URL. Locally Athens's hostname is
// athens.localhost, so its origin is the dev scheme with the server's port;
// Floyd's is https://floyd.civic.social.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { API_BASE } from "../fixtures/helpers.js";

async function createdEvent(hubId: string, host: string, email: string) {
  const token = await mintSession(hubId, email);
  const res = await call(
    "POST",
    "/process",
    host,
    {
      definition: { type: "civic.wordcloud", version: "0.1" },
      title: `Base URL ${hubId} ${Date.now()}`,
      description: "x",
      state: { prompts: [{ id: "p1", text: "One word?" }] },
    },
    token,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const rows = (await localRest(
    `events?process_id=eq.${res.body.id}&event_type=eq.civic.process.created&select=source,action_url`,
  )) as Array<{ source: { hub_url: string }; action_url: string }>;
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("each hub's events carry its own origin", () => {
  it("Athens's event names athens.localhost on the server's port", async () => {
    const port = new URL(API_BASE).port;
    const e = await createdEvent("athens", "athens.localhost", "admin+athens@example.test");
    expect(e.source.hub_url).toBe(`http://athens.localhost${port ? `:${port}` : ""}`);
    expect(e.action_url.startsWith("http://athens.localhost")).toBe(true);
  });

  it("Floyd's event names floyd.civic.social", async () => {
    const e = await createdEvent("floyd", "floyd.civic.social", "admin@example.test");
    expect(e.source.hub_url).toBe("https://floyd.civic.social");
    expect(e.action_url.startsWith("https://floyd.civic.social/")).toBe(true);
  });
});
