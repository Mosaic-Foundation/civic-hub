/**
 * Wire identity — what a hub has published keeps its identifiers (ADR-008).
 *
 * tests/fixtures/wire/before.json is the fixture hub's serialized output as
 * the serializer produced it before the Architecture-1 slice. Every
 * activity id, process IRI and actor IRI in it is one a hub was already
 * serving, so the same rows, as the 20261020000000 backfill leaves them,
 * must come out byte-for-byte the same, and keep doing so after the hub
 * moves. A failure here is a WIRE CHANGE to published history: fix the code,
 * never the file.
 *
 * One projection is allowed, and exactly one (Architecture 3; Adam,
 * 2026-10-21): the member and public views carry only the payload fields the
 * event's type declares public. The expectation is before.json with
 * projectDocumentPayload applied — the same transform the shape-diff script
 * allows — so anything beyond the declared projection still fails. The admin
 * view is compared without any transform.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKFILLED,
  WIRE_FIXTURE_HUB,
  serializeWireFixture,
  wireFixtureEvents,
} from "../fixtures/wire/wireFixture.js";
import { HUB_EXTENSION_NS } from "../../src/events/activitySerializer.js";
import { projectDocumentPayload } from "../../src/events/publicPayload.js";

const here = dirname(fileURLToPath(import.meta.url));
const BEFORE = JSON.parse(
  readFileSync(join(here, "../fixtures/wire/before.json"), "utf8"),
) as { event_types: string[]; documents: unknown[] };
const MIGRATION = readFileSync(
  join(here, "../../supabase/migrations/20261020000000_wire_origins.sql"),
  "utf8",
);

const MOVED_HUB = { ...WIRE_FIXTURE_HUB, hostname: "moved.example" };

function text(docs: unknown): string {
  return JSON.stringify(docs, null, 2);
}

/**
 * before.json with the one allowed transform: the declared public-payload
 * projection on the member and public views (Architecture 3). The event
 * types are sorted exactly as wireFixtureEvents() sorts them, so documents
 * pair with their types by position.
 */
function expectedDocuments(): unknown[] {
  const types = [...BEFORE.event_types].sort();
  return (BEFORE.documents as Array<Record<string, Record<string, unknown>>>).map((doc, i) => ({
    ...doc,
    member: projectDocumentPayload(doc.member, types[i]),
    public: projectDocumentPayload(doc.public, types[i]),
  }));
}

describe("wire identity — the fixture hub before and after", () => {
  it("serves the backfilled history byte-for-byte, apart from the declared payload projection", async () => {
    const now = await serializeWireFixture(wireFixtureEvents(BEFORE.event_types, BACKFILLED));
    expect(text(now)).toBe(text(expectedDocuments()));
    // The projection never touches an identifier or the admin view.
    const ids = (docs: unknown[]) =>
      docs.map((d) => {
        const doc = d as { event_id: string; admin: Record<string, unknown> };
        return [doc.event_id, doc.admin.id, (doc.admin.context as { id?: string } | undefined)?.id, doc.admin.actor];
      });
    expect(ids(now)).toEqual(ids(BEFORE.documents as unknown[]));
    expect(now.map((d) => text(d.admin))).toEqual(
      (BEFORE.documents as Array<{ admin: unknown }>).map((d) => text(d.admin)),
    );
  });

  it("serves the same bytes after the hub moves to a new hostname", async () => {
    const now = await serializeWireFixture(
      wireFixtureEvents(BEFORE.event_types, BACKFILLED),
      MOVED_HUB,
    );
    expect(text(now)).toBe(text(expectedDocuments()));
    expect(text(now)).not.toContain("moved.example");
  });

  it("mints a new event on the hostname the hub has when it is stored", async () => {
    const stored = { ...BACKFILLED, hostname: "moved.example", ns: HUB_EXTENSION_NS };
    const [doc] = await serializeWireFixture(
      wireFixtureEvents(["civic.process.created"], stored),
      MOVED_HUB,
    );
    expect(doc.admin.id).toBe("https://moved.example/activities/evt_wire_001");
    // The process and the participant keep the hostname they were created on.
    expect((doc.admin.context as { id: string }).id).toBe("https://wirefix.example/process/proc_wire_1");
    expect(doc.admin.actor).toBe("https://wirefix.example/users/u_resident");
  });

  it("declares the software namespace on new activities and the per-hub one on old", async () => {
    const [legacy] = await serializeWireFixture(
      wireFixtureEvents(["civic.project.created"], BACKFILLED),
    );
    const [current] = await serializeWireFixture(
      wireFixtureEvents(["civic.project.created"], { ...BACKFILLED, ns: HUB_EXTENSION_NS }),
    );
    expect(legacy.admin["@context"]).toContainEqual({ hub: "https://wirefix.example/ns#" });
    expect(current.admin["@context"]).toContainEqual({ hub: HUB_EXTENSION_NS });
  });

  it("serializes an unstored event as the database will stamp it", async () => {
    const [doc] = await serializeWireFixture(wireFixtureEvents(["civic.project.created"]));
    expect(doc.admin.id).toBe("https://wirefix.example/activities/evt_wire_001");
    expect(doc.admin["@context"]).toContainEqual({ hub: HUB_EXTENSION_NS });
  });

  it("the column default is the serializer's namespace", () => {
    expect(MIGRATION).toContain(`ALTER COLUMN wire_ns SET DEFAULT '${HUB_EXTENSION_NS}'`);
  });
});
