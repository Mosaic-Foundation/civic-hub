// Requests to the super admin (src/control/): the console hostname in Host,
// its session cookie, and the X-Civic-Console header every write needs.
// The operator's codes and sessions are written straight into the local
// stack as the service role, as mintSession() does for a hub's.

import { createHash, randomBytes } from "node:crypto";
import { request } from "node:http";
import { API_BASE } from "./helpers.js";
import { localRest } from "./adminSession.js";

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
  opts: { body?: unknown; cookie?: string; csrf?: boolean; host?: string } = {},
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

/** Put a known code in place, as if it had been emailed. */
export async function plantCode(purpose: "sign_in" | "step_up", code: string, email = OPERATOR): Promise<void> {
  await localRest("control_codes?on_conflict=email,purpose", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      email,
      purpose,
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 60 * 1000).toISOString(),
      attempts: 0,
      locked_until: null,
    }),
  });
}

export interface AuditRowForTest {
  action: string;
  actor_email: string;
  target_hub_id: string | null;
  before: any;
  after: any;
}

export async function auditFor(hubId: string): Promise<AuditRowForTest[]> {
  return (await localRest(
    `control_audit_log?target_hub_id=eq.${hubId}&select=action,actor_email,target_hub_id,before,after&order=id.asc`,
  )) as AuditRowForTest[];
}
