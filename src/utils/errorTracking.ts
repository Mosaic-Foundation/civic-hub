// Error tracking: what reportError() sends to Sentry (operations shell,
// ADR-006), and the one scrubber every error passes through on its way out.
//
// Not the Sentry SDK. This file builds Sentry's envelope by hand so the
// payload is exactly what is listed here and nothing an SDK adds on its own
// (request bodies, cookies, headers, the user, breadcrumbs of console lines).
// Any Sentry-compatible collector takes it.
//
// What leaves, and nothing else:
//   - the error's type and message, scrubbed (redactValues: no emails, quoted
//     values, URLs, ids, tokens or long numbers);
//   - its stack: function names, file paths below the project, line numbers;
//   - tags: the reporting code, the hub slug, the route pattern
//     (`/process/:id`, never the URL), the HTTP method and status;
//   - the release (deployed commit) and the environment (dev / production).
// Every string goes through scrub() once more on the way out, so a caller
// that slips a value into a detail still cannot leak an address.
//
// Off unless CIVIC_ERROR_DSN is set. A failing collector never fails the
// request or job that reported: sends are bounded by a timeout and their
// errors are swallowed (one warning per instance).

import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { deploymentCommit } from "../config/deployment.js";
import { currentHubIdOrNull } from "../config/hubContext.js";
import { redactValues } from "./redact.js";

/** How long a send, and a flush, may take. */
export const SEND_TIMEOUT_MS = 2000;
/** The same error is sent at most once per this long from one instance. */
const REPEAT_WINDOW_MS = 60_000;
/** Ceiling on frames sent per error. */
const MAX_FRAMES = 40;

export interface CaptureInput {
  /** Stable code, `http.unexpected`, `descriptor.civic.vote`, `ui.error`. */
  code: string;
  /** Already redacted by the caller where it can be; scrubbed again here. */
  message: string;
  /** The thrown value, for its type and stack. */
  error?: unknown;
  /** Plain tags; values must not carry a person's data (scrubbed anyway). */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** A stack from elsewhere (the browser's), instead of `error`'s. */
  stack?: string;
  /** Overrides the hub read from the request scope (the browser's report). */
  hub?: string | null;
  /** "javascript" for the browser's errors, "node" otherwise. */
  platform?: "node" | "javascript";
}

// ---------------------------------------------------------------------------
// The scrubber
// ---------------------------------------------------------------------------

/**
 * Remove anything that can name a person from a string before it leaves:
 * JSON objects (a request body) whole, redactValues()'s rules (emails, quoted
 * values, URLs, ids, tokens, long numbers), cookie and authorization pairs,
 * query strings, and a length cap.
 */
export function scrub(text: string, max = 500): string {
  // A request body or any JSON in a message goes whole: innermost braces
  // first, so nested objects collapse to one marker.
  let noJson = text;
  for (let i = 0; i < 5 && /\{[^{}]*\}/.test(noJson); i++) noJson = noJson.replace(/\{[^{}]*\}/g, "{…}");
  const pairs = noJson
    .replace(/\b(cookie|set-cookie|authorization|bearer|token|code|password|secret)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/(?<=\S)\?[^\s#]+/g, "?[query]");
  // redactValues caps at 300; long stacks are scrubbed line by line elsewhere.
  const out = pairs
    .split("\n")
    .map((line) => redactValues(line))
    .join("\n");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** A page path from the browser: no query, no fragment, ids and tokens replaced. */
export function scrubPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare
    .split("/")
    .map((seg) => (seg === "" ? seg : scrub(decodeSafe(seg), 80)))
    .join("/")
    .slice(0, 200);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

interface Frame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/**
 * Frames from a V8 stack (Node and Chromium), oldest call first as Sentry
 * wants them. Paths are cut to the project (`src/...`, `assets/...`), so
 * neither the server's directory layout nor a page's query reaches the payload.
 */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line.startsWith("at ")) {
      // Firefox / Safari: fn@url:line:col
      const m = /^(.*)@(.+?):(\d+):(\d+)$/.exec(line);
      if (m) frames.push(frame(m[1], m[2], m[3], m[4]));
      continue;
    }
    const m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (m) frames.push(frame(m[1], m[2], m[3], m[4]));
  }
  return frames.slice(0, MAX_FRAMES).reverse();
}

function frame(fn: string | undefined, file: string, line: string, col: string): Frame {
  const filename = projectPath(file);
  return {
    ...(fn ? { function: fn.replace(/\s+/g, " ").slice(0, 120) } : {}),
    filename,
    lineno: Number(line),
    colno: Number(col),
    in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
  };
}

function projectPath(file: string): string {
  const noScheme = file.replace(/^file:\/\//, "").replace(/^https?:\/\/[^/]+/, "");
  const noQuery = noScheme.split(/[?#]/)[0] ?? "";
  for (const root of ["/node_modules/", "/src/", "/api/", "/assets/", "/scripts/"]) {
    const i = noQuery.lastIndexOf(root);
    if (i >= 0) return noQuery.slice(i + 1);
  }
  return noQuery.startsWith("node:") ? noQuery : (noQuery.split("/").pop() ?? "");
}

export function errorEnvironment(): string {
  return env.CIVIC_ERROR_ENVIRONMENT ?? (env.NODE_ENV === "production" ? "production" : "development");
}

/** The Sentry event for one error. Pure apart from its id and time. */
export function buildEvent(input: CaptureInput): Record<string, unknown> {
  const err = input.error instanceof Error ? input.error : null;
  const type = err?.name ?? "Error";
  const value = scrub(input.message);
  const frames = parseStack(input.stack ?? err?.stack);
  const hub = input.hub !== undefined ? input.hub : currentHubIdOrNull();

  const tags: Record<string, string> = { code: input.code };
  if (hub) tags.hub = scrub(hub, 64);
  for (const [k, v] of Object.entries(input.tags ?? {})) {
    if (v === undefined || v === null) continue;
    tags[k] = scrub(String(v), 200);
  }

  const event: Record<string, unknown> = {
    event_id: randomBytes(16).toString("hex"),
    timestamp: Date.now() / 1000,
    platform: input.platform ?? "node",
    level: "error",
    logger: "civic-hub",
    release: deploymentCommit(),
    environment: errorEnvironment(),
    ...(tags.route ? { transaction: tags.route } : {}),
    tags,
    // Sentry fills the user from the sender's address unless told otherwise;
    // the sender is our server, but say so plainly.
    user: { ip_address: null },
  };
  if (frames.length > 0) {
    event.exception = { values: [{ type, value, stacktrace: { frames } }] };
  } else {
    event.message = { formatted: value };
  }
  // With no stack to group by, and for the browser, whose bundle's file names
  // change with every build, one code, type and (scrubbed) message is one
  // issue: the first occurrence alerts, the rest are counted under it. The
  // server's stacks group by Sentry's own rules.
  if (frames.length === 0 || event.platform === "javascript") event.fingerprint = [input.code, type, value];
  return event;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface Dsn {
  url: string;
  key: string;
  raw: string;
}

/** `https://<key>@<host>/<project>` → the envelope endpoint and the key. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project || u.protocol !== "https:") return null;
    return { url: `https://${u.host}/api/${project}/envelope/`, key: u.username, raw: dsn };
  } catch {
    return null;
  }
}

const pending = new Set<Promise<void>>();
const lastSent = new Map<string, number>();
let warned = false;

/** Is error tracking switched on for this deployment? */
export function errorTrackingEnabled(): boolean {
  return parseDsn(env.CIVIC_ERROR_DSN) !== null;
}

/**
 * Send one error, without waiting. Repeats of the same error from this
 * instance within a minute are dropped: Sentry counts the first, and a loop
 * of failures does not spend the month's quota.
 */
export function captureError(input: CaptureInput, fetchImpl: typeof fetch = fetch): void {
  const dsn = parseDsn(env.CIVIC_ERROR_DSN);
  if (!dsn) return;
  const event = buildEvent(input);
  const key = repeatKey(event);
  const now = Date.now();
  const last = lastSent.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
  lastSent.set(key, now);
  if (lastSent.size > 500) lastSent.clear();

  const p = send(dsn, event, fetchImpl).finally(() => pending.delete(p));
  pending.add(p);
}

function repeatKey(event: Record<string, unknown>): string {
  const ex = (event.exception as { values: Array<{ type: string; value: string; stacktrace: { frames: Frame[] } }> } | undefined)
    ?.values[0];
  const top = ex?.stacktrace.frames.at(-1);
  const tags = event.tags as Record<string, string>;
  return [tags.code, tags.hub ?? "", ex ? `${ex.type}:${ex.value}:${top?.filename}:${top?.lineno}` : JSON.stringify(event.message)].join("|");
}

/** The envelope body: header, item header, event, one per line. */
export function envelope(dsn: Dsn, event: Record<string, unknown>): string {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsn.raw }),
    JSON.stringify({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) }),
    payload,
  ].join("\n");
}

async function send(dsn: Dsn, event: Record<string, unknown>, fetchImpl: typeof fetch): Promise<void> {
  try {
    const res = await fetchImpl(dsn.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=civic-hub/1.0`,
      },
      body: envelope(dsn, event),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[error-tracking] send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Wait for every send in flight, at most `ms`. A serverless function may be
 * frozen once its response is out, so an error answer and a job's end wait
 * here first. Resolves at once when nothing is pending.
 */
export async function flushErrors(ms = SEND_TIMEOUT_MS): Promise<void> {
  if (pending.size === 0) return;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
  ]);
}

/** Anything still being sent (tests and the error answer). */
export function hasPendingErrors(): boolean {
  return pending.size > 0;
}

/** Tests only: forget the repeat window and the warning. */
export function resetErrorTrackingForTests(): void {
  lastSent.clear();
  pending.clear();
  warned = false;
}
