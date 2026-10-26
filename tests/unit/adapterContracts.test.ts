// One contract test per real adapter (ADR-012): does the vendor still answer
// the way the implementation in src/hosting/ expects? Each runs only when its
// key is in this shell's environment; CI sets none, so CI skips them all. The
// ones that leave a trace somewhere a person sees (a mail, an error issue, a
// heartbeat) also need CIVIC_CONTRACT_TESTS=1, so exporting a key for another
// reason sends nothing.
//
//   ANTHROPIC_API_KEY=… npx vitest run tests/unit/adapterContracts.test.ts
//
// Cost: the AI contract is one short call (a few hundred tokens).

import { describe, expect, it } from "vitest";
import { anthropicProvider } from "../../src/hosting/anthropic.js";
import { resendTransport } from "../../src/hosting/resend.js";
import { youtubeTranscripts } from "../../src/hosting/youtube.js";
import { sentryErrors } from "../../src/hosting/sentry.js";
import { healthchecksHeartbeat, heartbeatUrl } from "../../src/hosting/healthchecks.js";
import { polisService } from "../../src/hosting/polis.js";
import { createPolisAdapter } from "../../packages/civic.polis_deliberation/adapter/polisAdapter.js";

const has = (name: string) => Boolean(process.env[name]?.trim());
const visible = process.env.CIVIC_CONTRACT_TESTS === "1";

describe("adapter contracts (run only with the vendor's key)", () => {
  it.skipIf(!has("ANTHROPIC_API_KEY"))("ai: Anthropic answers a single turn and a reply tool", async () => {
    const one = await anthropicProvider.complete(
      { model: anthropicProvider.defaultModel(), userText: "Reply with the single word: ready", maxTokens: 10 },
      { purpose: "job.news_sync" },
    );
    expect(one.text.toLowerCase()).toContain("ready");
    expect(one.usage?.input_tokens).toBeGreaterThan(0);
    const turn = await anthropicProvider.converse(
      {
        model: anthropicProvider.defaultModel(),
        messages: [{ role: "user", content: "Say hello." }],
        maxTokens: 100,
        tools: [{ name: "respond", description: "Your reply.", input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } }],
        toolChoice: { type: "tool", name: "respond" },
        responseTool: "respond",
      },
      { purpose: "assistant.message" },
    );
    expect(typeof (turn.structured as { message?: unknown })?.message).toBe("string");
  }, 60_000);

  it.skipIf(!has("RESEND_API_KEY") || !visible)("mail: Resend accepts a message to its test address", async () => {
    const out = await resendTransport.send({
      from: process.env.RESEND_FROM ?? "Civic Hub <onboarding@resend.dev>",
      to: "delivered@resend.dev",
      subject: "civic-hub adapter contract",
      html: "<p>contract test</p>",
      text: "contract test",
    });
    expect(out).toMatchObject({ sent: true });
  }, 30_000);

  it.skipIf(!has("SUPADATA_API_KEY") && !has("SEARCHAPI_API_KEY"))("video: a public video's transcript", async () => {
    // A short, long-lived public talk with captions.
    const lines = await youtubeTranscripts.transcript("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    expect(lines.length).toBeGreaterThan(0);
    expect(typeof lines[0].start).toBe("number");
  }, 90_000);

  it.skipIf(!has("POLIS_AUTH_TOKEN") || !has("CIVIC_CONTRACT_POLIS_URL"))("deliberation: Polis answers a read with the service token", async () => {
    const adapter = createPolisAdapter({
      baseUrl: polisService.baseUrl(process.env.CIVIC_CONTRACT_POLIS_URL),
      authToken: polisService.authToken(),
      fetch: polisService.fetch,
    });
    // A conversation that does not exist: Polis answers, and the adapter turns it into an error, not a hang.
    await expect(adapter.getStatements("contract-test-missing")).rejects.toBeTruthy();
  }, 60_000);

  it.skipIf(!has("CIVIC_ERROR_DSN") || !visible)("errors: the collector accepts an envelope", async () => {
    const sink = sentryErrors();
    expect(sink.enabled()).toBe(true);
    await sink.send({ event_id: "0".repeat(32), timestamp: Date.now() / 1000, level: "info", message: { formatted: "civic-hub adapter contract" }, tags: { code: "contract" } });
  }, 30_000);

  it.skipIf(!has("CIVIC_HEARTBEAT_PING_KEY") || !visible)("heartbeat: Healthchecks.io takes a ping for the contract check", async () => {
    expect(heartbeatUrl("adapter_contract", true)).toMatch(/\/adapter-contract$/);
    await healthchecksHeartbeat.ping("adapter_contract", true);
  }, 30_000);
});
