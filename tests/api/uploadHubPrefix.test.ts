// Phase 4 part one: an image upload through the app lands under the
// requesting hub's prefix, in both CI passes — with the flag off (service
// role; the prefix is the only scoping) and on (hub token; the
// `post_images_hub_*` storage policies enforce the prefix, and
// leakHarnessDb.test.ts proves they refuse anything else).
//
// Needs the local stack with Storage on (supabase/config.toml) and a server
// (CIVIC_API_BASE). Athens's admin is admin+athens@example.test, Floyd's
// admin@example.test (supabase/seed.sql).

import { afterAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { deflateSync } from "node:zlib";
import { localStack, mintSession } from "../fixtures/adminSession.js";
import { API_BASE } from "../fixtures/helpers.js";

/** A square grey PNG, big enough for the logo floor (256 px). */
function png(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((size + 1) * size, 0x80);
  for (let y = 0; y < size; y++) rows[y * (size + 1)] = 0; // filter byte
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function upload(host: string, token: string, bytes: Buffer): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}/upload/hub-image?kind=logo`);
  const boundary = `----civic${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          Host: host,
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const uploaded: string[] = [];

afterAll(async () => {
  const { url, key } = localStack();
  for (const u of uploaded) {
    const path = u.split("/object/public/post-images/")[1];
    if (path) {
      await fetch(`${url}/storage/v1/object/post-images/${path}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      }).catch(() => undefined);
    }
  }
});

describe("an upload lands under the requesting hub's prefix", () => {
  for (const [hub, host, email] of [
    ["athens", "athens.localhost", "admin+athens@example.test"],
    ["floyd", "floyd.civic.social", "admin@example.test"],
  ] as const) {
    it(`${hub}: stored under ${hub}/identity/, and publicly readable`, async () => {
      const token = await mintSession(hub, email);
      const res = await upload(host, token, png(256));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      uploaded.push(res.body.url);
      expect(res.body.url).toContain(`/object/public/post-images/${hub}/identity/`);
      const read = await fetch(res.body.url);
      expect(read.status).toBe(200);
    });
  }
});
