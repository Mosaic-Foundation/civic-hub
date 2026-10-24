// events.wire_actor_did: the acting person's own DID, frozen at insert
// (20261023010000, ADR-011, item 5; Adam, Q4).
//
// The insert trigger copies users.identity_did onto the event only when the
// person set it themselves (identity_did_source = 'self'), only for a
// participant actor, and never again: setting or changing a DID later leaves
// every stored event as it was. Each case runs in a transaction that is rolled
// back, so nothing lands in the append-only log.
// LOCAL ONLY (pg on the stack). Needs no server; runs in both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`actorDid: refusing ${host}; local stack only.`);
}

let db: pg.Client;
const DID = "did:key:z6MkSelfSetExample";

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

/** A hub, an account, one event by `actor`; returns the stamped DID. Rolled back. */
async function stamped(opts: { did: string | null; source: string | null; actor?: (userId: string) => string }): Promise<string | null> {
  await db.query("BEGIN");
  try {
    const hub = `did-${randomBytes(4).toString("hex")}`;
    await db.query("INSERT INTO hubs (id, hostname, name, space_did, protocol_hub_id) VALUES ($1, $2, 'DID Test Hub', $3, $1)", [
      hub,
      `${hub}.localhost`,
      `did:web:${hub}.localhost`,
    ]);
    const userId = `user_${randomBytes(6).toString("hex")}`;
    await db.query(
      "INSERT INTO users (id, hub_id, email, email_verified, is_resident, identity_did, identity_did_source) VALUES ($1, $2, $3, true, true, $4, $5)",
      [userId, hub, `${userId}@example.test`, opts.did, opts.source],
    );
    const eventId = `evt_${randomBytes(6).toString("hex")}`;
    await db.query(
      "INSERT INTO events (id, hub_id, version, event_type, actor, data, meta, source) VALUES ($1, $2, '0.1', 'civic.process.created', $3, '{}'::jsonb, '{\"visibility\":\"public\"}'::jsonb, '{\"hub_id\":\"x\",\"hub_url\":\"https://x\"}'::jsonb)",
      [eventId, hub, opts.actor ? opts.actor(userId) : userId],
    );
    const first = (await db.query("SELECT wire_actor_did FROM events WHERE id = $1", [eventId])).rows[0].wire_actor_did as string | null;
    // Frozen: a DID set or changed afterwards does not reach the stored event.
    await db.query("UPDATE users SET identity_did = 'did:key:z6MkChangedLater', identity_did_source = 'self' WHERE id = $1", [userId]);
    const after = (await db.query("SELECT wire_actor_did FROM events WHERE id = $1", [eventId])).rows[0].wire_actor_did as string | null;
    expect(after).toBe(first);
    return first;
  } finally {
    await db.query("ROLLBACK");
  }
}

describe("events.wire_actor_did", () => {
  it("is the person's DID when they set it on their own account", async () => {
    expect(await stamped({ did: DID, source: "self" })).toBe(DID);
    expect(await stamped({ did: DID, source: "self", actor: (id) => `user:${id}` })).toBe(DID);
  });

  it("is null when the account has no DID (every account today)", async () => {
    expect(await stamped({ did: null, source: null })).toBeNull();
  });

  it("is null for a DID the person did not set themselves", async () => {
    expect(await stamped({ did: DID, source: null })).toBeNull();
  });

  it("is null for machinery and the anonymous actor", async () => {
    expect(await stamped({ did: DID, source: "self", actor: () => "system:brief-spawn" })).toBeNull();
    expect(await stamped({ did: DID, source: "self", actor: () => "anonymous" })).toBeNull();
  });

  it("refuses any source but the person's own", async () => {
    await db.query("BEGIN");
    try {
      await expect(
        db.query("UPDATE users SET identity_did_source = 'hub' WHERE id = (SELECT id FROM users LIMIT 1)"),
      ).rejects.toThrow(/users_identity_did_source_chk/);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("no stored event carries one, and no account has one", async () => {
    expect((await db.query("SELECT count(*)::int AS n FROM events WHERE wire_actor_did IS NOT NULL")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM users WHERE identity_did IS NOT NULL")).rows[0].n).toBe(0);
  });
});
