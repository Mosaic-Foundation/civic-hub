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
      reject(new Error("Expected multipart/form-data."));
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
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    bb.on("close", () => {
      if (resolved) return;
      resolved = true;
      if (truncated) {
        reject(
          new Error(
            `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`,
          ),
        );
        return;
      }
      if (chunks.length === 0) {
        reject(new Error("No file received in the upload."));
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
  /** Bucket prefix for the stored key, or undefined for the shared layout. */
  prefix?: (req: Request, res: Response) => string | undefined;
}

const POST_IMAGE_LIMITS: ImageUploadLimits = {
  minWidth: MIN_DIMENSION,
  minHeight: MIN_DIMENSION,
  maxDimension: MAX_DIMENSION,
  maxBytes: imageUploadMaxBytes,
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
    prefix: () => hubImagePrefix(currentHubId()),
  },
  logo: {
    minWidth: 256,
    minHeight: 256,
    maxDimension: 2000,
    mimeTypes: new Set(["image/png"]),
    square: true,
    maxBytes: () => Math.min(imageUploadMaxBytes(), 1024 * 1024),
    prefix: () => hubImagePrefix(currentHubId()),
  },
};

export function makeImageUploadHandler(limits: ImageUploadLimits) {
  return async function handleImageUpload(
    req: Request,
    res: Response,
  ): Promise<void> {
    await uploadImage(req, res, limits);
  };
}

export const handlePostImageUpload = makeImageUploadHandler(POST_IMAGE_LIMITS);

/** POST /upload/hub-image?kind=banner|logo — admin only. */
export async function handleHubImageUpload(
  req: Request,
  res: Response,
): Promise<void> {
  const kind = String(req.query.kind ?? "");
  if (kind !== "banner" && kind !== "logo") {
    res.status(400).json({ error: 'kind must be "banner" or "logo".' });
    return;
  }
  await uploadImage(req, res, HUB_IMAGE_LIMITS[kind]);
}

async function uploadImage(
  req: Request,
  res: Response,
  limits: ImageUploadLimits,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    if (!recordUpload(user.id)) {
      res.status(429).json({
        error: `Upload rate limit exceeded (${RATE_LIMIT} per hour). Try again later.`,
      });
      return;
    }

    const maxBytes = limits.maxBytes();
    const parsed = await parseSingleFile(req, maxBytes);

    if (limits.mimeTypes && !limits.mimeTypes.has(parsed.mime)) {
      res.status(400).json({ error: "This image must be a PNG." });
      return;
    }
    if (!POST_IMAGE_MIME_WHITELIST.has(parsed.mime)) {
      res.status(400).json({
        error: `Unsupported image type "${parsed.mime}". Allowed: JPEG, PNG, WebP, GIF.`,
      });
      return;
    }

    // Dimension probe — cheap header read, doesn't decode the full image.
    let dims: { width?: number; height?: number };
    try {
      dims = imageSize(parsed.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: `Could not read image dimensions: ${msg}` });
      return;
    }
    const w = dims.width ?? 0;
    const h = dims.height ?? 0;
    if (w < limits.minWidth || h < limits.minHeight) {
      res.status(400).json({
        error: `Image is too small (${w}×${h}). Minimum ${limits.minWidth}×${limits.minHeight}.`,
      });
      return;
    }
    if (limits.square && Math.abs(w - h) > Math.max(w, h) * 0.02) {
      res.status(400).json({
        error: `Image must be square (this one is ${w}×${h}).`,
      });
      return;
    }
    if (w > limits.maxDimension || h > limits.maxDimension) {
      res.status(400).json({
        error: `Image is too large (${w}×${h}). Resize to ${limits.maxDimension} px on the long edge before uploading. (The composer does this automatically — if you're seeing this on the web app, refresh and try again.)`,
      });
      return;
    }

    const prefix = limits.prefix?.(req, res);
    const { url } = await uploadPostImage(parsed.buffer, parsed.mime, prefix);
    res.status(201).json({ url, width: w, height: h, mime: parsed.mime });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    // 4xx for client-shaped errors, 500 for storage / server problems.
    const isClientErr =
      message.startsWith("Expected multipart") ||
      message.startsWith("No file") ||
      message.includes("upload limit") ||
      message.includes("Storage upload failed");
    res.status(isClientErr ? 400 : 500).json({ error: message });
  }
}
