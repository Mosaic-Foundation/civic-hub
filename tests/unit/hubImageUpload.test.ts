// @civic-raw-client-importer: stubs the storage client the upload handler uses.
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { deflateSync, crc32 } from "node:zlib";
import { randomBytes } from "node:crypto";

/**
 * A hub's banner and logo land under that hub's prefix in the image bucket.
 *
 * Unit, with the bucket write stubbed: what this proves is the part that is
 * ours — the key the handler asks storage to write, and the limits it applies
 * before asking. The real upload, in both token modes, is
 * tests/api/uploadHubPrefix.test.ts; what the storage policies refuse is the
 * storage block in tests/api/leakHarnessDb.test.ts.
 */

const uploads: string[] = [];

vi.mock("../../src/db/client.js", () => {
  const client = {
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploads.push(key);
          return { error: null };
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.test/${key}` } }),
      }),
    },
  };
  return { getDb: () => client, getHubTokenDb: () => client, hubTokensEnabled: () => false };
});

const { runWithHub } = await import("../../src/config/hubContext.js");
const { handleHubImageUpload, handlePostImageUpload } = await import(
  "../../src/controllers/uploadController.js"
);
const { makeImageKey, hubImagePrefix } = await import("../../src/services/postImageStorage.js");
const { ATHENS_HUB, FLOYD_HUB } = await import("../fixtures/hubs/index.js");

/** A real PNG of the given size — image-size reads its header. */
function png(width: number, height: number): Buffer {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function multipartRequest(file: Buffer, query: Record<string, string>, mime = "image/png") {
  const boundary = "----settingsTestBoundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = Readable.from([body]) as unknown as Record<string, unknown>;
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  };
  req.query = query;
  return req;
}

function fakeResponse(userId: string) {
  const res = {
    locals: { authUser: { id: userId, email: `${userId}@example.test` } },
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function upload(
  hub: typeof ATHENS_HUB,
  file: Buffer,
  kind: string,
  mime = "image/png",
  userId = `user_${Math.random().toString(36).slice(2)}`,
) {
  const req = multipartRequest(file, { kind }, mime);
  const res = fakeResponse(userId);
  await runWithHub(hub, {}, () =>
    handleHubImageUpload(req as any, res as any),
  );
  return res;
}

describe("hub image keys", () => {
  it("put a hub's banner and logo under <id>/identity/", () => {
    const key = makeImageKey(
      "image/webp",
      new Date("2026-09-24T00:00:00Z"),
      hubImagePrefix("athens", "identity"),
    );
    expect(key).toMatch(/^athens\/identity\/2026\/09\/[0-9a-f-]{36}\.webp$/);
  });

  it("put a hub's post images under <id>/", () => {
    const key = makeImageKey("image/png", new Date("2026-09-24T00:00:00Z"), hubImagePrefix("athens"));
    expect(key).toMatch(/^athens\/2026\/09\/[0-9a-f-]{36}\.png$/);
  });

  it("leave the shared layout alone when there is no prefix", () => {
    expect(makeImageKey("image/png", new Date("2026-09-24T00:00:00Z"))).toMatch(
      /^2026\/09\/[0-9a-f-]{36}\.png$/,
    );
  });

  it("refuse anything that is not a hub id", () => {
    for (const bad of ["", "../floyd", "Athens", "a/b", "x".repeat(33)]) {
      expect(() => hubImagePrefix(bad), bad).toThrow();
    }
  });
});

describe("POST /upload/hub-image", () => {
  it("stores a banner under the hub the request resolved to", async () => {
    uploads.length = 0;
    const res = await upload(ATHENS_HUB, png(800, 200), "banner");
    expect(res.statusCode).toBe(201);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/^athens\/identity\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect((res.body as { url: string }).url).toBe(`https://storage.test/${uploads[0]}`);
  });

  it("stores the same upload under Floyd when Floyd is the hub in scope", async () => {
    uploads.length = 0;
    const res = await upload(FLOYD_HUB, png(256, 256), "logo");
    expect(res.statusCode).toBe(201);
    expect(uploads[0]).toMatch(/^floyd\/identity\//);
  });

  it("takes a logo only as a square PNG of at least 256 px", async () => {
    uploads.length = 0;
    const notPng = await upload(ATHENS_HUB, png(300, 300), "logo", "image/webp");
    expect(notPng.statusCode).toBe(400);
    expect((notPng.body as { error: string }).error).toMatch(/PNG/);

    const oblong = await upload(ATHENS_HUB, png(400, 300), "logo");
    expect(oblong.statusCode).toBe(400);
    expect((oblong.body as { error: string }).error).toMatch(/square/);

    const small = await upload(ATHENS_HUB, png(128, 128), "logo");
    expect(small.statusCode).toBe(400);
    expect(uploads).toHaveLength(0);

    const nearlySquare = await upload(ATHENS_HUB, png(512, 506), "logo");
    expect(nearlySquare.statusCode).toBe(201);
  });

  it("applies the banner's size floor and the logo's", async () => {
    uploads.length = 0;
    const narrowBanner = await upload(ATHENS_HUB, png(300, 300), "banner");
    expect(narrowBanner.statusCode).toBe(400);
    expect((narrowBanner.body as { error: string }).error).toMatch(/Minimum 600×100/);

    const tinyLogo = await upload(ATHENS_HUB, png(16, 16), "logo");
    expect(tinyLogo.statusCode).toBe(400);

    const bigLogo = await upload(ATHENS_HUB, png(2100, 40), "logo");
    expect(bigLogo.statusCode).toBe(400);
    expect(uploads).toHaveLength(0);
  });

  it("refuses a file over the logo's 1 MB limit before storing it", async () => {
    uploads.length = 0;
    // Incompressible bytes after a valid header, so the body really is > 1 MB.
    const oversized = Buffer.concat([png(256, 256), randomBytes(1_100_000)]);
    const res = await upload(ATHENS_HUB, oversized, "logo");
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/upload limit/);
    expect(uploads).toHaveLength(0);
  });

  it("refuses a kind it does not know", async () => {
    const res = await upload(ATHENS_HUB, png(800, 200), "favicon");
    expect(res.statusCode).toBe(400);
  });

  it("puts post images under the request's hub", async () => {
    uploads.length = 0;
    const req = multipartRequest(png(400, 400), {});
    const res = fakeResponse("user_post_image");
    await runWithHub(ATHENS_HUB, {}, () => handlePostImageUpload(req as any, res as any));
    expect(res.statusCode).toBe(201);
    expect(uploads[0]).toMatch(/^athens\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
  });
});
