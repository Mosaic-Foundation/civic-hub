// Requests to the platform console (the test host makes the suite's two
// throwaway hubs through it): the console hostname in Host, its session
// cookie, and the X-Civic-Console header every write needs. The operator's
// session is written straight into the local stack as the service role, as
// mintSession() does for a hub's.

import { createHash, randomBytes } from "node:crypto";
import { request } from "node:http";
import { API_BASE, freshTestIp } from "./http.js";
import { localRest } from "./localStack.js";

/** Must match the server's CIVIC_CONSOLE_HOSTNAME / CIVIC_CONSOLE_ADMIN_EMAIL (CI sets both). */
export const CONSOLE_HOST = process.env.CIVIC_TEST_CONSOLE_HOST ?? "console.localhost";
export const OPERATOR = process.env.CIVIC_TEST_CONSOLE_OPERATOR ?? "operator@example.test";

export interface ConsoleResponse {
  status: number;
  body: any;
  setCookie: string | undefined;
}

export function consoleCall(
  method: string,
  path: string,
  // ip: the client address the server's rate limits see (X-Forwarded-For).
  // Each call gets a fresh one unless a test names it, so suites never share
  // the console's per-IP buckets (Audit 2).
  opts: { body?: unknown; cookie?: string; csrf?: boolean; host?: string; ip?: string } = {},
): Promise<ConsoleResponse> {
  const url = new URL(`${API_BASE}${path}`);
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Accept: "application/json",
          Host: opts.host ?? CONSOLE_HOST,
          "Content-Type": "application/json",
          "X-Forwarded-For": opts.ip ?? freshTestIp(),
          ...(opts.csrf === false ? {} : { "X-Civic-Console": "1" }),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const header = res.headers["set-cookie"];
          const setCookie = Array.isArray(header) ? header[0] : header;
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {}, setCookie });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { raw }, setCookie });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** A signed-in console session for the operator; returns the Cookie header value. */
export async function mintConsoleSession(email = OPERATOR): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await localRest("control_sessions", {
    method: "POST",
    body: JSON.stringify({
      token_hash: sha256(token),
      email,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  return `civic_console=${encodeURIComponent(token)}`;
}
