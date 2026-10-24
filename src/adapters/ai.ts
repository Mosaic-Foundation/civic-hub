// The `ai` adapter (ADR-012): every model call the hub makes goes through
// aiComplete / aiConverse here, never to a provider directly.
//
// Two halves. The PROVIDER is the hosting layer's (src/hosting/anthropic.ts,
// or the fake in src/adapters/fakes/ai.ts): it talks to one vendor, retries a
// transient failure once, and classifies its failures. The GATE is this file,
// the engine's, and every caller gets it:
//   - a scheduled job's call (JOB_PURPOSES) is refused once the hub's jobs
//     have used `job_daily_tokens` in the last 24 hours (AiLimits, the
//     console's per-hub override), and an `ai.job_budget` report goes to the
//     errors adapter, once per hub per day per server. Residents are not
//     affected: their budget counts only the assistant's purposes.
//   - every call that answers is recorded in `ai_usage` with its purpose.
//   - a refusal because the provider account's usage limit or credit is used
//     up is reported as `ai.usage_limit` (the Oct 24 incident).
// A resident's call is admitted once per request, before any call, with
// admitAiCall() (src/services/aiBudget.ts): one request may make two calls
// (the assistant's follow-up nudge) and must count once.

import { CivicError, UnavailableError } from "../errors/index.js";
import { currentHubIdOrNull } from "../config/hubContext.js";
import { reportError } from "../utils/reportError.js";
import { JOB_PURPOSES, jobTokensToday, recordAiUsage, currentAiLimits, type AiPurpose } from "../services/aiBudget.js";
import { adapters } from "./index.js";

// --- What a caller asks ------------------------------------------------------

export interface AiSingleTurnInput {
  model: string;
  system?: string;
  userText: string;
  /** Base64-encoded document for PDF input. */
  documentBase64?: { data: string; mediaType: string; filename?: string };
  /** Upper bound on generated tokens. */
  maxTokens?: number;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiConversationInput {
  model: string;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  tools?: unknown[];
  /** e.g. {type:"any"} (must call some tool) or {type:"tool", name:"respond"}. */
  toolChoice?: unknown;
  /** Name of the client-defined tool whose call IS the reply; its input is returned as `structured`. */
  responseTool?: string;
}

export interface AiResult {
  text: string;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  /** Server-side tool calls (web search) during the turn. */
  serverToolUses?: number;
  /** The `responseTool` call's input, when the caller named one. */
  structured?: unknown;
}

/** What a call is for. Recorded on every call; decides which budget it counts against. */
export type { AiPurpose };

export { JOB_PURPOSES };

/** Call metadata the provider may read (the fake answers by purpose). */
export interface AiCallContext {
  purpose: AiPurpose;
}

// --- The provider (hosting) ---------------------------------------------------

export interface AiProvider {
  /** "anthropic", "fake", "none". */
  readonly name: string;
  /** Has what it needs to make a call (a key). */
  configured(): boolean;
  /** The model a caller uses unless it has a reason not to. */
  defaultModel(): string;
  complete(input: AiSingleTurnInput, ctx: AiCallContext): Promise<AiResult>;
  converse(input: AiConversationInput, ctx: AiCallContext): Promise<AiResult>;
}

/**
 * The provider's account refused the call because its usage limit or credit
 * is used up. A provider marks the error it throws with this flag; the gate
 * reports it.
 */
export interface UsageLimitMarked {
  aiUsageLimit?: true;
}

/** No provider is set up on this deployment: the person is told so in words. */
export function aiNotConfigured(): UnavailableError {
  return new UnavailableError(
    "The assistant isn't set up on this hub yet. Please contact the hub admin.",
    "ai_not_configured",
  );
}

/** The hub's scheduled jobs have used their day's tokens. */
export class AiJobBudgetError extends CivicError {
  constructor() {
    super(429, "ai_job_budget_spent", "This hub's scheduled AI work has reached its daily limit; it resumes within 24 hours.");
  }
}

// --- The gate -----------------------------------------------------------------

export function aiConfigured(): boolean {
  return adapters().ai.configured();
}

export function aiDefaultModel(): string {
  return adapters().ai.defaultModel();
}

export function isJobPurpose(purpose: AiPurpose): boolean {
  return JOB_PURPOSES.includes(purpose);
}

/** One `ai.job_budget` report per hub per rolling day per server. */
const reportedJobBudget = new Map<string, number>();
const DAY_MS = 24 * 60 * 60 * 1000;

async function admitJobCall(purpose: AiPurpose): Promise<void> {
  const hubId = currentHubIdOrNull();
  if (!hubId) return;
  const limit = currentAiLimits().job_daily_tokens;
  let spent: number;
  try {
    spent = await jobTokensToday(hubId);
  } catch (err) {
    // The ledger could not be read (the database is down, so the job's own
    // writes will fail too): let the call through rather than fail a job on
    // the ceiling's account. The next call reads it again.
    console.error(`[ai] the jobs' token total for ${hubId} could not be read: ${(err as Error).message}`);
    return;
  }
  if (spent < limit) return;
  const last = reportedJobBudget.get(hubId);
  if (last === undefined || Date.now() - last > DAY_MS) {
    reportedJobBudget.set(hubId, Date.now());
    reportError("ai.job_budget", "A hub's scheduled jobs reached their daily AI token ceiling; job calls pause until it rolls over.", {
      hub: hubId,
      purpose,
      spent,
      limit,
    });
  }
  throw new AiJobBudgetError();
}

async function gated(purpose: AiPurpose, model: string, call: () => Promise<AiResult>): Promise<AiResult> {
  const provider = adapters().ai;
  if (!provider.configured()) {
    console.error(`[ai] no AI provider is configured (${provider.name})`);
    throw aiNotConfigured();
  }
  if (isJobPurpose(purpose)) await admitJobCall(purpose);
  let result: AiResult;
  try {
    result = await call();
  } catch (err) {
    const marked = (err as { cause?: UsageLimitMarked } & UsageLimitMarked) ?? {};
    if (marked.aiUsageLimit || marked.cause?.aiUsageLimit) {
      reportError("ai.usage_limit", "The AI provider refused a call: the account's usage limit or credit is used up.", {
        detail: String((marked.cause as Error | undefined)?.message ?? (err as Error).message).slice(0, 200),
      });
    }
    throw err;
  }
  await recordAiUsage({ purpose, model, usage: result.usage, webSearches: result.serverToolUses ?? 0 });
  return result;
}

/** One question, one answer. */
export function aiComplete(purpose: AiPurpose, input: AiSingleTurnInput): Promise<AiResult> {
  return gated(purpose, input.model, () => adapters().ai.complete(input, { purpose }));
}

/** A conversation turn, with tools. */
export function aiConverse(purpose: AiPurpose, input: AiConversationInput): Promise<AiResult> {
  return gated(purpose, input.model, () => adapters().ai.converse(input, { purpose }));
}

/** Tests only: forget which hubs were reported. */
export function resetAiGateForTests(): void {
  reportedJobBudget.clear();
}
