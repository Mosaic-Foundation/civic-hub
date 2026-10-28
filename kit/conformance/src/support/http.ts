// Requests to the test host with an explicit Host header: the hostname picks
// the hub, and fetch() will not let a caller set Host. node:http will.

import { request } from "node:http";
import * as zlib from "node:zlib";
/** The test host the suite talks to (CIVIC_API_BASE). */
export const API_BASE = process.env.CIVIC_API_BASE?.trim() || "http://localhost:3000";

/**
 * A made-up client address for X-Forwarded-For: the hub's sign-in limits count
 * per address, so a fresh one per request keeps one run from using up another's.
 */
export function freshTestIp(): string {
  const n = () => Math.floor(Math.random() * 256);
  return `10.${n()}.${n()}.${1 + Math.floor(Math.random() * 254)}`;
}

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
  return callAt(API_BASE, method, path, host, body, token, ip, headers);
}

/** `call`, to a server other than the one under test (a second instance). */
export function callAt(
  base: string,
  method: string,
  path: string,
  host: string,
  body?: unknown,
  token?: string,
  ip: string = freshTestIp(),
  headers: Record<string, string> = {},
): Promise<HostResponse> {
  const url = new URL(`${base}${path}`);
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

/** One multipart upload of a single file (`file`) to the test server, as if made to `host`. */
export function callUpload(path: string, host: string, file: Buffer, mime: string, token?: string): Promise<HostResponse> {
  const boundary = "----civicConformanceBoundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image"\r\nContent-Type: ${mime}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = new URL(`${API_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          Accept: "application/json",
          Host: host,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "X-Forwarded-For": freshTestIp(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    req.write(body);
    req.end();
  });
}

/** A real PNG of the given size (an upload check reads its header). */
export function pngOf(width: number, height: number): Buffer {
  const { deflateSync, crc32 } = zlib;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
