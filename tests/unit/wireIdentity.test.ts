/**
 * Wire identity — what a hub has published keeps its identifiers (ADR-008).
 *
 * tests/fixtures/wire/before.json is the fixture hub's serialized output as
 * the serializer produced it before the Architecture-1 slice. Every
 * activity id, process IRI and actor IRI in it is one a hub was already
 * serving, so it must come out byte-for-byte the same, in all three views
 * (admin, member, public). A failure here is a WIRE CHANGE to published
 * history: fix the code, never the file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeWireFixture, wireFixtureEvents } from "../fixtures/wire/wireFixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const BEFORE = JSON.parse(
  readFileSync(join(here, "../fixtures/wire/before.json"), "utf8"),
) as { event_types: string[]; documents: unknown[] };

describe("wire identity — the fixture hub before and after", () => {
  it("serializes the published history byte-for-byte as before", async () => {
    const events = wireFixtureEvents(BEFORE.event_types);
    const now = await serializeWireFixture(events);
    expect(JSON.stringify(now, null, 2)).toBe(JSON.stringify(BEFORE.documents, null, 2));
  });
});
