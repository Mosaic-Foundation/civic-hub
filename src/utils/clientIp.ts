// The caller's IP, for rate limits.
//
// On Vercel, x-forwarded-for is set by Vercel itself (a client's own value is
// replaced), so its first hop is the client. Locally there is no proxy and the
// header is whatever the caller sent, which is what lets tests give each run
// its own buckets. A self-hosted deployment behind a proxy that passes a
// client's header through must strip it there, or the limits are per
// whatever-the-client-claims.

import type { Request } from "express";

export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",")[0]!.trim() : "";
  return first || req.ip || "unknown";
}
