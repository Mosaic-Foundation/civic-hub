// Each hub's /api/health, read by the console's server for the Dashboard.
//
// The same request Better Stack makes (RUNBOOK-operations.md): 200 is up, 503
// with JSON is degraded (its schema gaps are shown), anything else, a refused
// connection or no answer within HEALTH_TIMEOUT_MS is down. Cached for a
// minute (cache.ts). Our own hubs, at the hostnames in the registry: no SSRF
// guard, since no admin chose the address, and nothing is sent.
//
// With CIVIC_DASHBOARD_FAKE=on (refused in production) the request goes to
// this server itself with the hub's hostname in Host, so a local console never
// asks a production hub; a hub whose slug contains "slow" is sent to a local
// listener that accepts and never answers, so tests reach the real timeout.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import { env } from "../../config/env.js";
import { dashboardFakeEnabled } from "../../config/devFlags.js";
import { cached } from "./cache.js";

export const HEALTH_TIMEOUT_MS = 3_000;
const MAX_BODY_BYTES = 64 * 1024;

export interface HubHealth {
  state: "up" | "degraded" | "down";
  http_status: number | null;
  /** The commit the hub reports it runs. */
  commit: string | null;
  /** "table: detail" lines from a 503's schema report. */
  gaps: string[];
  /** Why it is down or degraded, in a few words. */
  reason: string | null;
  ms: number;
}

interface Target {
  url: URL;
  host: string;
}

let blackHole: Promise<number> | null = null;

/** A listener that accepts connections and never answers (fake mode only). */
function blackHolePort(): Promise<number> {
  blackHole ??= new Promise((resolve, reject) => {
    const server = net.createServer(() => {
      // Hold the socket open; the client's timeout ends it.
    });
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
  return blackHole;
}

async function targetFor(hub: { id: string; hostname: string }): Promise<Target> {
  if (dashboardFakeEnabled()) {
    const port = hub.id.includes("slow") ? await blackHolePort() : Number(env.PORT ?? 3000);
    return { url: new URL(`http://127.0.0.1:${port}/health`), host: hub.hostname };
  }
  return { url: new URL(`https://${hub.hostname}/api/health`), host: hub.hostname };
}

function get(target: Target, timeoutMs: number): Promise<{ status: number; body: string }> {
  const lib = target.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target.url,
      { method: "GET", headers: { Host: target.host, Accept: "application/json", "User-Agent": "CivicHub-Console-Dashboard" } },
      (res) => {
        let body = "";
        let size = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("answer too large"));
            return;
          }
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        res.on("error", reject);
      },
    );
    // A hard limit on the whole answer, not only on silence: a hub that
    // trickles bytes is cut off too.
    const timer = setTimeout(() => req.destroy(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

/** Read a health answer. Pure; pinned by tests/unit/dashboard.test.ts. */
export function readHealth(status: number, body: string): Omit<HubHealth, "ms"> {
  let json: { status?: unknown; commit?: unknown; schema?: { gaps?: unknown }; db?: { ok?: unknown }; hub_db?: { ok?: unknown } } | null = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const commit = typeof json?.commit === "string" ? json.commit : null;
  const gaps = Array.isArray(json?.schema?.gaps) ? json!.schema!.gaps.map(String) : [];
  if (status === 200 && json?.status === "ok") return { state: "up", http_status: status, commit, gaps: [], reason: null };
  if (status === 503 && json) {
    const reason =
      json.db?.ok === false
        ? "database not answering"
        : json.hub_db?.ok === false
          ? "hub's database check failed"
          : gaps.length > 0
            ? "schema gaps"
            : "degraded";
    return { state: "degraded", http_status: status, commit, gaps, reason };
  }
  return { state: "down", http_status: status, commit, gaps: [], reason: `answered ${status}` };
}

function failureReason(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ECONNRESET") return "connection dropped";
  if (typeof code === "string" && code.startsWith("ERR_TLS") || code === "CERT_HAS_EXPIRED") return "certificate problem";
  return err instanceof Error ? err.message : String(err);
}

export function hubHealth(hub: { id: string; hostname: string }, fresh: boolean): Promise<HubHealth> {
  return cached(`health:${hub.id}:${hub.hostname}`, fresh, async () => {
    const started = Date.now();
    try {
      const res = await get(await targetFor(hub), HEALTH_TIMEOUT_MS);
      return { ...readHealth(res.status, res.body), ms: Date.now() - started };
    } catch (err) {
      return {
        state: "down" as const,
        http_status: null,
        commit: null,
        gaps: [],
        reason: failureReason(err),
        ms: Date.now() - started,
      };
    }
  });
}
