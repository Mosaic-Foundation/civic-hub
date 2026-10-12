// The one check that a /internal/*/run call carries the CRON_SECRET bearer.
// Vercel Cron injects it; a manual run passes it by hand. No secret set
// means nothing is authorized.

import { env } from "../config/env.js";
export function isCronAuthorized(authorization: string | undefined): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  // A plain compare is acceptable for a shared, machine-chosen secret that
  // this path gives no way to probe for partial matches.
  return token.length > 0 && token === secret;
}
