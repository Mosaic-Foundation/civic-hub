// Limits on what other servers may make the hub do (security audit
// 2026-11-14, M2). Anyone can run a fediverse server, and every message to
// the hub's inbox costs it work: a fetch of the sender's profile and key, a
// row, a reply. So:
//
//   - blocked servers: a hub's admins list servers (and every server under a
//     domain: "example.social" blocks "a.example.social" too) whose messages
//     are refused and whose accounts cannot follow;
//   - a rate limit per sending server, and one for the whole inbox, counted
//     in the database so every server instance shares them;
//   - a ceiling on followers per hub;
//   - deliveries only to https addresses (outside production a local test
//     server may be http), through the hub's internal-address block.

import { getSettingSync, privateFetchAllowed } from "../../src/sdk/index.js";

export const BLOCKED_SERVERS_KEY = "plugin.fediverse.blocked_servers";

/** Messages one server may send one hub's inbox in ten minutes. */
export const PER_SERVER_LIMIT = 120;
/** Messages all servers together may send one hub's inbox in ten minutes. */
export const PER_HUB_LIMIT = 2_000;
export const LIMIT_WINDOW_MS = 10 * 60 * 1000;
/** Followers one hub may have. */
export const FOLLOWER_CEILING = 50_000;

/** A hostname, lowercase, from a line an admin typed: "example.social", "@a@example.social", "https://example.social/x". */
export function serverOf(line: string): string | null {
  let s = line.trim().toLowerCase();
  if (!s || s.startsWith("#")) return null;
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#:].*$/, "").replace(/^\*\./, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s) ? s : null;
}

/** The hub in scope's blocked servers. */
export function blockedServers(): string[] {
  const raw = getSettingSync(BLOCKED_SERVERS_KEY) ?? "";
  return [...new Set(raw.split(/[\n,]+/).map(serverOf).filter((s): s is string => s !== null))];
}

/** Whether `host` is a blocked server or under one. */
export function isBlocked(host: string, blocked: readonly string[] = blockedServers()): boolean {
  const h = host.toLowerCase();
  return blocked.some((b) => h === b || h.endsWith(`.${b}`));
}

/**
 * The server that signed a request: the host of the key named in its
 * Signature (draft-cavage, what Mastodon sends) or Signature-Input (RFC 9421)
 * header. Null when there is none, which Fedify then refuses.
 */
export function signingServer(headers: { get(name: string): string | null }): string | null {
  const sig = headers.get("signature") ?? "";
  const cavage = /keyId="([^"]+)"/i.exec(sig)?.[1];
  const rfc = /keyid="([^"]+)"/i.exec(headers.get("signature-input") ?? "")?.[1];
  const id = cavage ?? rfc;
  if (!id) return null;
  try {
    return new URL(id).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether the hub may deliver to `url`: https, or http to a local test server outside production. */
export function deliverable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && privateFetchAllowed();
  } catch {
    return false;
  }
}
