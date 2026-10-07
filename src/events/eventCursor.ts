// Event page cursors — shared by GET /events (the AS2 wire) and GET /api/feed
// (the hub UI's read model). Opaque to consumers (Civic Activity Spec v0.2
// §6.1): base64url of `created_at|id`, the keyset getEventPage reads after.

import type { EventCursor } from "./eventStore.js";

export const INVALID_CURSOR = Symbol("invalid-cursor");

export function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(
  raw: unknown,
): EventCursor | null | typeof INVALID_CURSOR {
  const value = firstQueryValue(raw);
  if (!value) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return INVALID_CURSOR;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return INVALID_CURSOR;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!createdAt || !id) return INVALID_CURSOR;
  // The cursor's parts go into a PostgREST `or` filter; anything that is not
  // a timestamp and a plain id is refused rather than passed through.
  if (Number.isNaN(Date.parse(createdAt)) || !/^[\w.:-]+$/.test(id)) {
    return INVALID_CURSOR;
  }
  return { createdAt, id };
}

/** A query parameter's first value, trimmed; undefined when empty. */
export function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return undefined;
}
