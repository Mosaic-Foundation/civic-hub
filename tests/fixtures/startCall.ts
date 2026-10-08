// Requests to the start page (src/control/startRouter.ts, session 4b): the
// start hostname in Host, its session cookie, the X-Civic-Start header every
// write needs, and an X-Forwarded-For so each test has its own rate-limit
// buckets. Sign-in codes are planted straight into the local stack, as
// plantCode() does for the console's.

import { createHash, randomInt } from "node:crypto";
import { request } from "node:http";
import { API_BASE } from "./helpers.js";
import { localRest } from "./adminSession.js";

/** Must match the server's CIVIC_START_HOSTNAME (CI sets it). */
export const START_HOST = process.env.CIVIC_TEST_START_HOST ?? "start.localhost";

export interface StartResponse {
  status: number;
  body: any;
  setCookie: string | undefined;
}

/** A fresh, made-up client address: its rate-limit buckets are empty. */
export function freshIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export function startCall(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean; host?: string; ip?: string } = {},
): Promise<StartResponse> {
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
          Host: opts.host ?? START_HOST,
          "Content-Type": "application/json",
          ...(opts.csrf === false ? {} : { "X-Civic-Start": "1" }),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
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

/** The `name=value` part of a Set-Cookie header, for the next request's Cookie. */
export function cookieFrom(setCookie: string | undefined): string {
  if (!setCookie) throw new Error("no Set-Cookie on the response");
  return setCookie.split(";")[0]!;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Put a known sign-in code in place for `email`, as if it had been emailed. */
export async function plantStartCode(email: string, code: string): Promise<void> {
  await localRest("start_codes?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      email,
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 60 * 1000).toISOString(),
      attempts: 0,
      locked_until: null,
    }),
  });
}

/**
 * The start page as far as the form: a good invite code, then a sign-in
 * with a planted code. Returns the session cookie.
 */
export async function signedInStart(code: string, email: string, ip = freshIp()): Promise<string> {
  const invite = await startCall("POST", "/start/invite", { body: { code }, ip });
  if (invite.status !== 200) throw new Error(`invite refused: ${JSON.stringify(invite.body)}`);
  const cookie = cookieFrom(invite.setCookie);
  await plantStartCode(email, "112233");
  const verify = await startCall("POST", "/start/verify", { cookie, ip, body: { email, code: "112233" } });
  if (verify.status !== 200) throw new Error(`verify refused: ${JSON.stringify(verify.body)}`);
  return cookie;
}
