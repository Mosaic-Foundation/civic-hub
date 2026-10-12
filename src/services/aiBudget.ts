// Enforcing the AI limits (Audit 2, A6): per-person and per-hub call limits,
// kept in Postgres (src/db/rateLimit.ts), and a per-hub token budget over the
// last 24 hours, summed from ai_usage. The numbers are src/shared/aiLimits.ts,
// with the operator's overrides from the console.
//
// Every call the budget counts is recorded here too (recordAiUsage), with its
// purpose, its model and its tokens, and no account id.

import { CivicError } from "../errors/index.js";
import { forHub } from "../db/forHub.js";
import { DAY_MS, HOUR_MS, takeRateLimit } from "../db/rateLimit.js";
import { currentHubId, currentHubIdOrNull } from "../config/hubContext.js";
import { getSettingSync, hubModeSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import { effectiveAiLimits, type AiLimits } from "../shared/aiLimits.js";

/** What an AI call was for. The budget counts every "assistant." purpose. */
export type AiPurpose = "assistant.message" | "assistant.suggest" | "assistant.review";
const BUDGET_PURPOSES: readonly AiPurpose[] = ["assistant.message", "assistant.suggest", "assistant.review"];

/** Refused by a limit. `status` is what the HTTP layer answers. */
export class AiLimitError extends CivicError {
  constructor(
    message: string,
    status: number,
    /** The hub's budget is spent (as opposed to one person's limit). */
    readonly budget = false,
  ) {
    super(status, budget ? "ai_budget_spent" : "ai_rate_limited", message);
  }
}

export const BUDGET_SPENT =
  "The assistant has done all it can for this hub today. Please try again tomorrow.";
const TOO_MANY_FOR_YOU = "You've asked the assistant a lot in a short time. Please wait a while and try again.";
const TOO_MANY_CHECKS = "You've run the check many times this hour. Please wait a while and try again.";
const HUB_BUSY = "The assistant is very busy on this hub right now. Please try again in a little while.";

/** The limits for the hub serving this request. */
export function currentAiLimits(): AiLimits {
  return effectiveAiLimits(hubModeSync(), getSettingSync(KEYS.LIMITS_AI));
}

/**
 * May this person make this call now? Throws AiLimitError if not; otherwise
 * the call is counted against the person's and the hub's limits.
 *
 * The budget is checked first and is not atomic with the call (a few calls in
 * flight at the moment it runs out finish); the counts are.
 */
export async function admitAiCall(kind: "chat" | "review", userId: string): Promise<AiLimits> {
  const limits = currentAiLimits();
  const hubId = currentHubId();

  const spent = await tokensToday(hubId);
  if (spent >= limits.daily_tokens) throw new AiLimitError(BUDGET_SPENT, 429, true);

  const user = `${hubId}:${userId}`;
  const checks =
    kind === "chat"
      ? [
          { scope: "ai.chat", by: "user", value: user, limit: limits.user_per_hour, windowMs: HOUR_MS },
          { scope: "ai.chat.day", by: "user", value: user, limit: limits.user_per_day, windowMs: DAY_MS },
          { scope: "ai.chat", by: "hub", value: hubId, limit: limits.hub_per_hour, windowMs: HOUR_MS },
        ]
      : [{ scope: "ai.review", by: "user", value: user, limit: limits.review_per_hour, windowMs: HOUR_MS }];
  const refused = await takeRateLimit(checks);
  if (refused) {
    throw new AiLimitError(refused.by === "hub" ? HUB_BUSY : kind === "review" ? TOO_MANY_CHECKS : TOO_MANY_FOR_YOU, 429);
  }
  return limits;
}

async function tokensToday(hubId: string): Promise<number> {
  const total = await forHub(hubId).rpc<number | string>("ai_tokens_since", {
    p_since: new Date(Date.now() - DAY_MS).toISOString(),
    p_purposes: BUDGET_PURPOSES,
  });
  return Number(total) || 0;
}

/**
 * Record one model call against the hub in scope. Never throws: a failed
 * write is logged, and the person still gets their answer.
 */
export async function recordAiUsage(entry: {
  purpose: AiPurpose;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  webSearches?: number;
}): Promise<void> {
  const hubId = currentHubIdOrNull();
  if (!hubId) return;
  try {
    await forHub(hubId).from("ai_usage").insert({
      purpose: entry.purpose,
      model: entry.model,
      input_tokens: Math.max(0, Math.round(entry.usage?.input_tokens ?? 0)),
      output_tokens: Math.max(0, Math.round(entry.usage?.output_tokens ?? 0)),
      web_searches: Math.max(0, entry.webSearches ?? 0),
    });
  } catch (err) {
    console.error(`[ai-usage] not recorded for ${hubId}: ${(err as Error).message}`);
  }
}
