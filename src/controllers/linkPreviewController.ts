// Slice 9 — GET /api/link-preview?url=<encoded>
//
// Public, cacheable endpoint. Always returns HTTP 200 with a LinkPreview
// JSON body — even on upstream failure (the `error` field carries the
// reason). The frontend's <LinkPreviewCard> renders nothing-or-plain-link
// when `error` is set, so the response shape stays uniform.
//
// Rate limit: 60 requests/minute/IP. In-memory, best-effort — same
// caveat as the upload limiter (multi-isolate Vercel deploys mean the
// limit is per-isolate, not per-deployment). Hardening path: a small
// Postgres counter table or Vercel KV.

import { RateLimitedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Request } from "express";
import { validatePreviewUrl } from "../modules/civic.link_preview/index.js";
import { getOrRefreshPreview } from "../services/linkPreviewCache.js";

const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 60;
const ipHits = new Map<string, number[]>();

function clientKey(req: Request): string {
  // The `x-forwarded-for` header is set by Vercel; we take the first
  // hop. Not authoritative for security decisions, but fine for a
  // best-effort rate cap.
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip || "unknown";
}

function checkRate(key: string): boolean {
  const now = Date.now();
  const arr = ipHits.get(key) ?? [];
  const fresh = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT) {
    ipHits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  ipHits.set(key, fresh);
  return true;
}

export const handleGetLinkPreview = route(async (req, res) => {
  const key = clientKey(req);
  if (!checkRate(key)) {
    throw new RateLimitedError(`Rate limit exceeded (${RATE_LIMIT}/min). Slow down.`);
  }

  const raw = req.query.url;
  if (typeof raw !== "string") {
    throw new ValidationError("Missing required query parameter: url");
  }
  const validation = validatePreviewUrl(raw);
  if ("error" in validation) {
    throw new ValidationError(validation.error, "invalid_url");
  }

  try {
    const preview = await getOrRefreshPreview(validation.url);
    // Keep responses cacheable at the edge, but only for short windows
    // so corrected OG tags propagate within a day.
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.status(200).json(preview);
  } catch (err) {
    // A preview is decoration: a page that can't be fetched answers 200 with
    // empty fields, and the reason stays in the log.
    console.warn("[link-preview] preview failed:", err instanceof Error ? err.message : err);
    res.status(200).json({
      url: validation.url,
      canonical_url: null,
      title: null,
      description: null,
      image_url: null,
      site_name: null,
      fetched_at: new Date().toISOString(),
      error: "A preview isn't available for this link.",
    });
  }
});
