// Tiny Anthropic client — posts to the Messages API.
// No SDK dependency; keeps the deployable surface small (same philosophy
// as utils/email.ts for Resend).
//
// Two entry points:
//   callClaude          — single-turn (one user message, one response)
//   callClaudeMultiTurn — multi-turn conversation (messages array)
//
// Env vars:
//   ANTHROPIC_API_KEY  — required. Starts with `sk-ant-…`.
//   ANTHROPIC_MODEL    — optional; default defined in DEFAULT_MODEL.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/**
 * Hard per-call ceiling. If a single Claude invocation doesn't return
 * within this many milliseconds we abort and throw — better to fail
 * one meeting (isolated) than to let a stuck call burn the whole
 * Vercel function's 300s budget.
 */
const CALL_TIMEOUT_MS = 180_000;

/**
 * Pinned default model. Operators can override via ANTHROPIC_MODEL.
 * Sonnet-tier balances cost and quality for multi-document summarization.
 * Bumped from sonnet-4-5 to sonnet-4-6 on 2026-04-24 after the former
 * returned 404 from /v1/messages (model name didn't resolve on the
 * live API). If Anthropic releases a Sonnet 4.7+ later, operators can
 * override via the ANTHROPIC_MODEL env var without touching code.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface CallClaudeInput {
  model: string;
  system?: string;
  userText: string;
  /** Base64-encoded document for PDF input (native document block). */
  documentBase64?: { data: string; mediaType: string; filename?: string };
  /** Upper bound on generated tokens. */
  maxTokens?: number;
}

export interface CallClaudeResult {
  text: string;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  id?: string;
  model: string;
  /** "end_turn" | "max_tokens" | "tool_use" | "pause_turn" | … */
  stop_reason?: string;
  content: AnthropicContent[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

/**
 * One in-function retry on transient failure (HTTP 5xx or network error),
 * then give up. Matches the slice's scope note: no complex backoff.
 */
export async function callClaude(
  input: CallClaudeInput,
): Promise<CallClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  try {
    return await callClaudeOnce(apiKey, input);
  } catch (err) {
    if (!isTransient(err)) throw err;
    await sleep(2000);
    return callClaudeOnce(apiKey, input);
  }
}

async function callClaudeOnce(
  apiKey: string,
  input: CallClaudeInput,
): Promise<CallClaudeResult> {
  const userContent: unknown[] = [];
  if (input.documentBase64) {
    userContent.push({
      type: "document",
      source: {
        type: "base64",
        media_type: input.documentBase64.mediaType,
        data: input.documentBase64.data,
      },
      ...(input.documentBase64.filename
        ? { title: input.documentBase64.filename }
        : {}),
    });
  }
  userContent.push({ type: "text", text: input.userText });

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    messages: [{ role: "user", content: userContent }],
  };
  if (input.system) body.system = input.system;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Anthropic API call exceeded ${CALL_TIMEOUT_MS}ms — aborted`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    const errText = await res.text();
    const isServer = res.status >= 500 && res.status < 600;
    const err = new Error(
      `Anthropic API ${res.status}: ${errText.slice(0, 300)}`,
    );
    (err as Error & { transient?: boolean }).transient = isServer;
    throw err;
  }

  const data = (await res.json()) as AnthropicResponse;
  if (data.error) {
    throw new Error(
      `Anthropic error: ${data.error.type} ${data.error.message}`,
    );
  }

  const text = (data.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");

  return {
    text,
    model: data.model ?? input.model,
    usage: data.usage,
  };
}

// --- Multi-turn conversation support ---

export interface MultiTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallClaudeMultiTurnInput {
  model: string;
  system?: string;
  messages: MultiTurnMessage[];
  maxTokens?: number;
  tools?: unknown[];
}

export async function callClaudeMultiTurn(
  input: CallClaudeMultiTurnInput,
): Promise<CallClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const doCall = () => callClaudeMultiTurnOnce(apiKey, input);
  try {
    return await doCall();
  } catch (err) {
    if (!isTransient(err)) throw err;
    await sleep(2000);
    return doCall();
  }
}

async function callClaudeMultiTurnOnce(
  apiKey: string,
  input: CallClaudeMultiTurnInput,
): Promise<CallClaudeResult> {
  const messages: unknown[] = input.messages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }));

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    messages,
  };
  if (input.system) {
    body.system = [
      {
        type: "text",
        text: input.system,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  if (input.tools && input.tools.length > 0) body.tools = input.tools;

  const MAX_TOOL_ROUNDS = 5;
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Anthropic API call exceeded ${CALL_TIMEOUT_MS}ms — aborted`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!res.ok) {
      const errText = await res.text();
      const isServer = res.status >= 500 && res.status < 600;
      const err = new Error(
        `Anthropic API ${res.status}: ${errText.slice(0, 300)}`,
      );
      (err as Error & { transient?: boolean }).transient = isServer;
      throw err;
    }

    const data = (await res.json()) as AnthropicResponse;
    if (data.error) {
      throw new Error(
        `Anthropic error: ${data.error.type} ${data.error.message}`,
      );
    }

    if (data.usage) {
      totalUsage.input_tokens += data.usage.input_tokens ?? 0;
      totalUsage.output_tokens += data.usage.output_tokens ?? 0;
    }

    // Server-side tools (web search) can run long enough that the API
    // pauses the turn and hands back what it has so far — typically the
    // model's "On it — searching now" text plus the server_tool_use block.
    // That is NOT the reply: the turn continues by sending the content back
    // as the assistant message and calling again. Before 2026-09-02 this
    // fell through to the no-tool_use branch below and the pre-search text
    // was returned as the whole answer, so search results, the summary,
    // and the sources suggestion card never reached the person.
    if (data.stop_reason === "pause_turn") {
      (messages as Record<string, unknown>[]).push({
        role: "assistant",
        content: data.content,
      });
      body.messages = messages;
      continue;
    }

    if (data.stop_reason === "max_tokens") {
      console.warn(
        `[anthropic] response truncated at max_tokens=${String(body.max_tokens)} — ` +
          "a JSON reply cut here fails to parse and loses its suggestion cards",
      );
    }

    // If stop_reason is "end_turn" or no tool_use blocks, we're done
    const hasToolUse = (data.content ?? []).some(
      (c: AnthropicContent) => c.type === "tool_use",
    );

    if (!hasToolUse) {
      const text = (data.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("");

      return { text, model: data.model ?? input.model, usage: totalUsage };
    }

    // Tool use detected — the API handles server-side tools (web_search)
    // automatically. For server-side tools, the results come back in the
    // same response as server_tool_use + server_tool_result blocks. Extract
    // text from the full content array.
    const textParts = (data.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);

    if (textParts.length > 0) {
      return {
        text: textParts.join(""),
        model: data.model ?? input.model,
        usage: totalUsage,
      };
    }

    // If we got tool_use but no text yet, append assistant response and
    // tool results to messages for the next round (client-side tool pattern).
    // For server-side tools this shouldn't happen, but handle gracefully.
    (messages as Record<string, unknown>[]).push({
      role: "assistant",
      content: data.content,
    });

    const toolResults = (data.content ?? [])
      .filter((c: AnthropicContent) => c.type === "tool_use")
      .map((c: AnthropicContent) => ({
        type: "tool_result",
        tool_use_id: c.id,
        content: "Tool executed server-side.",
      }));

    (messages as Record<string, unknown>[]).push({
      role: "user",
      content: toolResults,
    });

    body.messages = messages;
  }

  throw new Error("Tool use loop exceeded maximum rounds");
}

function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    if ((err as Error & { transient?: boolean }).transient === true) return true;
    // Common network / fetch transient errors.
    if (/fetch failed|network|ECONN|ETIMEDOUT|aborted/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
