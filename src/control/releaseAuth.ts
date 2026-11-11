// The release's credential for approving first-party catalog entries
// (ADR-015 amendment, console slice): CIVIC_RELEASE_SECRET as a bearer.
// Unset means no release approves anything. A plain compare, as for
// CRON_SECRET (src/jobs/cronAuth.ts): a shared, machine-chosen secret this
// path gives no way to probe for partial matches.

import { env } from "../config/env.js";
import { ControlInputError } from "./errors.js";

export function isReleaseAuthorized(authorization: string | undefined): boolean {
  const secret = env.CIVIC_RELEASE_SECRET;
  if (!secret) return false;
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  return token.length > 0 && token === secret;
}

/** `{ commit, entries: [{ package, version, hash }] }`, checked. */
export function parseReleaseApproval(body: unknown): { commit: string; entries: Array<{ package: string; version: string; hash: string }> } {
  const b = (body ?? {}) as { commit?: unknown; entries?: unknown };
  if (typeof b.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(b.commit)) {
    throw new ControlInputError("commit: the released commit, 7 to 40 hex characters.", 400);
  }
  if (!Array.isArray(b.entries) || b.entries.length === 0 || b.entries.length > 50) {
    throw new ControlInputError("entries: 1 to 50 of { package, version, hash }.", 400);
  }
  const entries = b.entries.map((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    if (typeof x.package !== "string" || typeof x.version !== "string" || typeof x.hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(x.hash)) {
      throw new ControlInputError("Each entry is { package, version, hash: sha256:<64 hex> }.", 400);
    }
    return { package: x.package, version: x.version, hash: x.hash };
  });
  return { commit: b.commit, entries };
}
