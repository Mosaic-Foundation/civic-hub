// Account ids (`user_` + 16 hex) belong to their owner and the hub's admins.
// accountIds.test.ts and the conformance suite check every answer a resident
// or a visitor gets against this.

import { call } from "./hostCall.js";

const ACCOUNT_ID = /user_[0-9a-f]{16}/g;

/**
 * Where an answer carries an account id that isn't `own`: the JSON path of
 * each one ("process.state.supporters.<id>" for an id used as a key).
 */
export function foreignIds(body: unknown, own: string | null): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      for (const id of v.match(ACCOUNT_ID) ?? []) if (id !== own) out.push(path || "(body)");
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const key = (k.match(ACCOUNT_ID) ?? []).some((id) => id !== own) ? "<account id>" : k;
        if (key !== k) out.push(path ? `${path}.<key>` : "<key>");
        walk(x, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(body, "");
  return [...new Set(out.map((p) => p.replace(/\[\d+\]/g, "[]")))];
}

const ids = new Map<string, string>();

/** The account id a session belongs to (cached per token). */
export async function accountIdOf(host: string, token: string): Promise<string> {
  if (!ids.has(token)) {
    const me = await call("GET", "/auth/me", host, undefined, token);
    const id = me.body.id ?? me.body.user?.id;
    if (typeof id !== "string" || !id.startsWith("user_")) throw new Error(`no account id for a session: ${JSON.stringify(me.body)}`);
    ids.set(token, id);
  }
  return ids.get(token)!;
}
