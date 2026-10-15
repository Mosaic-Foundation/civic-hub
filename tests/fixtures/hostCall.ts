// Requests with an explicit Host header: the hostname is the variable under
// test, and fetch() will not let a caller set Host. node:http will.

import { request } from "node:http";
import { API_BASE, freshTestIp } from "./helpers.js";

export interface HostResponse {
  status: number;
  body: any;
  headers: import("node:http").IncomingHttpHeaders;
}

/**
 * One request to the test server, as if made to `host`. `ip` is the client
 * address the rate limits see (X-Forwarded-For); a fresh one by default, so
 * only a test of the limits shares a bucket on purpose (Audit 2).
 */
export function call(
  method: string,
  path: string,
  host: string,
  body?: unknown,
  token?: string,
  ip: string = freshTestIp(),
  headers: Record<string, string> = {},
): Promise<HostResponse> {
  const url = new URL(`${API_BASE}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Accept: "application/json",
          Host: host,
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {}, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { raw }, headers: res.headers });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
