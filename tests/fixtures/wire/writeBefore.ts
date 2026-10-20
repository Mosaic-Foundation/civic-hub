// One-off: writes tests/fixtures/wire/before.json from the CURRENT serializer.
// Run once, before the Architecture-1 slice changed anything (2026-10-20):
//   npx tsx tests/fixtures/wire/writeBefore.ts
// Never rerun it to make a red test green: the file is the invariant.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mappedEventTypes } from "../../../src/events/activitySerializer.js";
import { serializeWireFixture, wireFixtureEvents } from "./wireFixture.js";

const events = wireFixtureEvents(mappedEventTypes());
const docs = await serializeWireFixture(events);
const out = join(dirname(fileURLToPath(import.meta.url)), "before.json");
writeFileSync(out, JSON.stringify({ event_types: mappedEventTypes(), documents: docs }, null, 2) + "\n");
console.log(`wrote ${docs.length} events × 3 audiences to ${out}`);
