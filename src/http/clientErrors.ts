// POST /client-errors (and /api/client-errors on Vercel): an error the
// browser hit, forwarded to error tracking (operations shell, ADR-006).
//
// The browser never calls a third party: the page posts here, on its own
// origin, and the Content-Security-Policy keeps `connect-src 'self'`. What
// the page sends is untrusted, so only these fields are read, each capped,
// and all of them go through the same scrubber as the server's own errors:
//   name, message, stack, path (the page's path; query and fragment dropped),
//   surface ("hub", "console" or "start"), commit (the UI's build).
// No body, cookie, header or address is forwarded. The hub is read from the
// hostname, never from the body.
//
// Mounted by the front door (src/control/index.ts) for every hostname, ahead
// of the hub app, so a page that failed before its hub resolved can still
// report. Answers 204 whatever happens: a page must not retry or show this.

import express, { Router, type Request, type Response } from "express";
import { captureError, flushErrors } from "../utils/errorTracking.js";
import { scrub, scrubPath } from "../utils/errorTracking.js";
import { clientIp } from "../utils/clientIp.js";
import { normalizeHostname, resolveHubForHostname } from "../middleware/hub.js";

/** Reports one address may send per minute, and one instance in all. */
const PER_IP = 10;
const PER_INSTANCE = 120;
const WINDOW_MS = 60_000;

let windowStart = 0;
let total = 0;
const perIp = new Map<string, number>();

/** Under the per-minute caps? Counts the report when it is. */
export function allowClientError(ip: string, now = Date.now()): boolean {
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    total = 0;
    perIp.clear();
  }
  const mine = perIp.get(ip) ?? 0;
  if (mine >= PER_IP || total >= PER_INSTANCE) return false;
  perIp.set(ip, mine + 1);
  total += 1;
  return true;
}

export function resetClientErrorLimitsForTests(): void {
  windowStart = 0;
  total = 0;
  perIp.clear();
}

const SURFACES = new Set(["hub", "console", "start"]);

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null;
}

/** What is forwarded from a browser's report. Pure; tests/unit/errorTracking.test.ts. */
export function readClientError(body: unknown): {
  name: string;
  message: string;
  stack: string | undefined;
  path: string;
  surface: string;
  commit: string | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const message = str(b.message, 1000);
  if (!message) return null;
  const surface = str(b.surface, 16) ?? "hub";
  const commit = str(b.commit, 64);
  return {
    name: (str(b.name, 64) ?? "Error").replace(/[^A-Za-z0-9_.$]/g, ""),
    message: scrub(message),
    stack: str(b.stack, 8000) ?? undefined,
    path: scrubPath(str(b.path, 500) ?? "/"),
    surface: SURFACES.has(surface) ? surface : "hub",
    commit: commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
  };
}

export function clientErrorsRouter(): Router {
  const r = Router();
  r.post(
    "/client-errors",
    express.json({ limit: "16kb", type: () => true }),
    async (req: Request, res: Response) => {
      try {
        const report = readClientError(req.body);
        if (report && allowClientError(clientIp(req))) {
          const hub =
            report.surface === "hub"
              ? ((await resolveHubForHostname(normalizeHostname(req.headers.host ?? req.hostname)).catch(() => null))
                  ?.id ?? null)
              : null;
          const err = Object.assign(new Error(report.message), { name: report.name });
          captureError({
            code: "ui.error",
            message: `${report.name}: ${report.message}`,
            error: err,
            stack: report.stack ?? `${report.name}: ${report.message}\n`,
            hub,
            platform: "javascript",
            tags: { route: report.path, surface: report.surface, ui_commit: report.commit },
          });
          await flushErrors();
        }
      } catch {
        // Never an error answer for an error report.
      }
      res.status(204).end();
    },
  );
  // A body the JSON parser refused (too large, not JSON): still 204.
  r.use("/client-errors", (_err: unknown, _req: Request, res: Response, _next: unknown) => {
    void _next;
    res.status(204).end();
  });
  return r;
}
