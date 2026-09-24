// Requests with an explicit Host header: the hostname is the variable under
// test, and fetch() will not let a caller set Host. node:http will.

import { request } from "node:http";
import { API_BASE } from "./helpers.js";

export interface HostResponse {
  status: number;
  body: any;
}

/** One request to the test server, as if made to `host`. */
export function call(
  method: string,
  path: string,
  host: string,
  body?: unknown,
  token?: string,
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
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { raw } });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
