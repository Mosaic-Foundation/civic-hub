// Slice 9 — POST /api/upload/post-image
//
// Accepts a multipart/form-data upload from authorized announcement /
// vote-results posters. Validates MIME, size, and image dimensions, then
// hands the bytes to postImageStorage for the actual Supabase Storage
// write. Returns { url } on success.
//
// Why no `sharp` (despite the spec's hint): the Vercel deploy is a
// single Express-wrapped serverless function (api/index.ts). Adding
// sharp would inflate the bundle by ~30 MB and slow every cold start,
// not just uploads. The composers do client-side canvas resize + WebP
// re-encoding, which strips EXIF naturally and keeps server-side
// processing minimal. We probe dimensions cheaply with `image-size`
// (header-only read, ~10 KB) as a guard against pathological uploads
// that bypassed the client resize.

import { NotFoundError, PayloadTooLargeError, RateLimitedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Request, Response } from "express";
import busboy from "busboy";
import { imageSize } from "image-size";
import { getAuthUser } from "../middleware/auth.js";
import {
  POST_IMAGE_MIME_WHITELIST,
  hubImagePrefix,
  imageUploadMaxBytes,
  uploadPostImage,
} from "../services/postImageStorage.js";
import { currentHubId } from "../config/hubContext.js";
import { getManifest } from "../processes/registry.js";
import { typeMayUseAdapter } from "../plugins/grant.js";
import { isProcessTypeEnabled } from "../services/pluginGate.js";

// Image dimension caps. The lower bound rejects accidental favicons /
// 1×1 tracking pixels; the upper bound caps storage cost and rendering
// jank — anything above 4000 px on the long edge belongs in a CMS, not
// inline civic posts.
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 4000;

// Simple in-memory upload rate limit: 20 uploads / hour / authenticated
// user. The serverless function may run on multiple isolates so this
// is best-effort, not a security control. The hard guarantee comes from
// the auth gate (only admins / configured authors can hit this route).
// A future hardening path is a Postgres table + atomic upsert; out of
// scope for MVP.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 20;
const uploadCounts = new Map<string, number[]>();

function recordUpload(userId: string): boolean {
  const now = Date.now();
  const arr = uploadCounts.get(userId) ?? [];
  const fresh = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT) {
    uploadCounts.set(userId, fresh);
    return false;
  }
  fresh.push(now);
  uploadCounts.set(userId, fresh);
  return true;
}

interface ParsedUpload {
  buffer: Buffer;
  mime: string;
  filename: string;
}

function parseSingleFile(
  req: Request,
  maxBytes: number,
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const headers = req.headers;
    const contentType = headers["content-type"];
    if (!contentType || !contentType.startsWith("multipart/form-data")) {
      reject(new ValidationError("Expected multipart/form-data.", "invalid_upload"));
      return;
    }

    const bb = busboy({
      headers: headers as Record<string, string>,
      limits: { files: 1, fileSize: maxBytes, fields: 0 },
    });

    let resolved = false;
    let chunks: Buffer[] = [];
    let totalBytes = 0;
    let mime = "";
    let filename = "";
    let truncated = false;

    bb.on("file", (_name, stream, info) => {
      mime = (info.mimeType || "").toLowerCase();
      filename = info.filename || "upload";
      stream.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("end", () => {
        // resolve fired in 'close' below to ensure busboy is done
      });
    });

    bb.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      // Busboy only errors on a malformed multipart body: the sender's fault.
      reject(new ValidationError("That upload couldn't be read.", "invalid_upload"));
    });

    bb.on("close", () => {
      if (resolved) return;
      resolved = true;
      if (truncated) {
        reject(
          new PayloadTooLargeError(
            `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`,
            "image_too_large",
          ),
        );
        return;
      }
      if (chunks.length === 0) {
        reject(new ValidationError("No file received in the upload.", "no_file"));
        return;
      }
      resolve({ buffer: Buffer.concat(chunks), mime, filename });
    });

    req.pipe(bb);
  });
}

/**
 * What one upload route accepts. The defaults are the post-image limits every
 * route used before hub images existed.
 */
export interface ImageUploadLimits {
  minWidth: number;
  minHeight: number;
  maxDimension: number;
  maxBytes: () => number;
  /** Narrower than the shared whitelist, when set. */
  mimeTypes?: ReadonlySet<string>;
  /** Width and height within 2% of each other. */
  square?: boolean;
  /** Bucket prefix for the stored key: always under the request's hub. */
  prefix: (req: Request, res: Response) => string;
}

const POST_IMAGE_LIMITS: ImageUploadLimits = {
  minWidth: MIN_DIMENSION,
  minHeight: MIN_DIMENSION,
  maxDimension: MAX_DIMENSION,
  maxBytes: imageUploadMaxBytes,
  prefix: () => hubImagePrefix(currentHubId()),
};

/**
 * A hub's own images, uploaded from the admin Settings page. They land under
 * the hub's prefix in the bucket (see hubImagePrefix).
 *
 * A banner is a wide strip, so its floor is a width, not a square. A logo is
 * the browser-tab icon and a mark on the home page (Adam, 2026-09-24), so it
 * is a square PNG — transparency survives, and a square is what an icon slot
 * is — at least 256 px so it stays sharp on a phone's home screen, and at
 * most 1 MB.
 */
export const HUB_IMAGE_LIMITS: Readonly<Record<"banner" | "logo", ImageUploadLimits>> = {
  banner: {
    minWidth: 600,
    minHeight: 100,
    maxDimension: MAX_DIMENSION,
    maxBytes: imageUploadMaxBytes,
    prefix: () => hubImagePrefix(currentHubId(), "identity"),
  },
  logo: {
    minWidth: 256,
    minHeight: 256,
    maxDimension: 2000,
    mimeTypes: new Set(["image/png"]),
    square: true,
    maxBytes: () => Math.min(imageUploadMaxBytes(), 1024 * 1024),
    prefix: () => hubImagePrefix(currentHubId(), "identity"),
  },
};

export function makeImageUploadHandler(limits: ImageUploadLimits) {
  return route(async (req, res) => {
    await uploadImage(req, res, limits);
  });
}

export const handlePostImageUpload = makeImageUploadHandler(POST_IMAGE_LIMITS);

/** POST /upload/hub-image?kind=banner|logo — admin only. */
export const handleHubImageUpload = route(async (req, res) => {
  const kind = String(req.query.kind ?? "");
  if (kind !== "banner" && kind !== "logo") {
    throw new ValidationError('kind must be "banner" or "logo".');
  }
  await uploadImage(req, res, HUB_IMAGE_LIMITS[kind]);
});

/**
 * POST /upload/process-image/:type (Events 2, E1): an image a process type's
 * residents attach (an event's picture). Open only to a type whose manifest
 * declares `uploads: { images: true }`, whose grant (and the hub's approved
 * grant) names `objectStore`, and whose plugin is on; anything else is 404,
 * as an unknown route. The post-image checks; the key under
 * `<hub_id>/types/<type>/`. The type stores the URL it is given.
 */
export const handleProcessImageUpload = route(async (req, res) => {
  const type = String(req.params.type ?? "");
  const manifest = getManifest(type);
  if (
    !manifest?.uploads?.images ||
    !typeMayUseAdapter(type, "objectStore") ||
    !isProcessTypeEnabled(type)
  ) {
    throw new NotFoundError("Not found");
  }
  await uploadImage(req, res, { ...POST_IMAGE_LIMITS, prefix: () => `${hubImagePrefix(currentHubId())}/types/${type}` });
});

async function uploadImage(
  req: Request,
  res: Response,
  limits: ImageUploadLimits,
): Promise<void> {
  const user = getAuthUser(res);
  if (!recordUpload(user.id)) {
    throw new RateLimitedError(`Upload rate limit exceeded (${RATE_LIMIT} per hour). Try again later.`, "upload_rate_limited");
  }

  const maxBytes = limits.maxBytes();
  const parsed = await parseSingleFile(req, maxBytes);

  if (limits.mimeTypes && !limits.mimeTypes.has(parsed.mime)) {
    throw new ValidationError("This image must be a PNG.", "unsupported_image_type");
  }
  if (!POST_IMAGE_MIME_WHITELIST.has(parsed.mime)) {
    throw new ValidationError(
      `Unsupported image type "${parsed.mime}". Allowed: JPEG, PNG, WebP, GIF.`,
      "unsupported_image_type",
    );
  }

  // Dimension probe — cheap header read, doesn't decode the full image.
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(parsed.buffer);
  } catch {
    throw new ValidationError("That file doesn't look like a valid image.", "invalid_image");
  }
  const w = dims.width ?? 0;
  const h = dims.height ?? 0;
  if (w < limits.minWidth || h < limits.minHeight) {
    throw new ValidationError(
      `Image is too small (${w}×${h}). Minimum ${limits.minWidth}×${limits.minHeight}.`,
      "image_dimensions",
    );
  }
  if (limits.square && Math.abs(w - h) > Math.max(w, h) * 0.02) {
    throw new ValidationError(`Image must be square (this one is ${w}×${h}).`, "image_dimensions");
  }
  if (w > limits.maxDimension || h > limits.maxDimension) {
    throw new ValidationError(
      `Image is too large (${w}×${h}). Resize to ${limits.maxDimension} px on the long edge before uploading. (The composer does this automatically — if you're seeing this on the web app, refresh and try again.)`,
      "image_dimensions",
    );
  }

  const prefix = limits.prefix(req, res);
  const { url } = await uploadPostImage(currentHubId(), parsed.buffer, parsed.mime, prefix);
  res.status(201).json({ url, width: w, height: h, mime: parsed.mime });
}
