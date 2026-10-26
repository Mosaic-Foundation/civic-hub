/**
 * The emission path checks every event against its type's declared events
 * (plugin architecture §5a, Stage 1; Architecture 2: the declarations are the
 * manifests'): an event a type does not declare is refused outside
 * production, before it is stored. Every event a manifest declares builds.
 * For a plugin package's type the capability grant refuses it first, in
 * production too (ADR-014; tests/unit/pluginGrant.test.ts): its grant's events
 * are its descriptor's, so the two refuse the same events.
 */
import { describe, it, expect } from "vitest";
import { buildEvent } from "../../src/events/eventEmitter.js";
import { DescriptorViolationError, HOST_EVENT_TYPES, registerDescriptor } from "../../src/processes/descriptor.js";
import { getManifests } from "../../src/processes/registry.js";
import { withHubScope } from "../../src/config/hubContext.js";
import { GrantRefusedError } from "../../src/plugins/grant.js";
import { WIRE_FIXTURE_HUB } from "../fixtures/wire/wireFixture.js";

function build(eventType: string, processType: string) {
  return withHubScope(WIRE_FIXTURE_HUB, {}, async () =>
    buildEvent({
      event_type: eventType,
      actor: "system:test",
      process_id: "proc_emission_check",
      jurisdiction: "us-zz-wirefix",
      processType,
      data: { title: "Emission check", result: {}, move: { space: "did:web:x", from: "https://x", to: "https://y" } },
    }),
  );
}

describe("the emission path's declared-type check", () => {
  it("refuses a package's event its grant does not name, before anything is stored", async () => {
    await expect(build("civic.process.vote_submitted", "civic.wordcloud")).rejects.toThrow(GrantRefusedError);
    await expect(build("civic.project.created", "civic.polis_deliberation")).rejects.toThrow(GrantRefusedError);
  });

  it("refuses an event a type no package provides does not declare, naming the type and the event", async () => {
    // Every shipped type is a package now; a descriptor registered on its own
    // still has the descriptor check (plugin architecture §5a, Stage 1).
    const vote = getManifests().find((m) => m.descriptor.type === "civic.vote")!.descriptor;
    registerDescriptor({ ...vote, type: "civic.emission_check", emits: ["civic.process.started"] });
    await expect(build("civic.project.created", "civic.emission_check")).rejects.toThrow(
      "civic.emission_check emitted civic.project.created, which its descriptor does not declare",
    );
  });

  it("builds every event each manifest declares, and the host's events for every type", async () => {
    for (const m of getManifests()) {
      for (const eventType of [...m.descriptor.emits, ...HOST_EVENT_TYPES]) {
        // A declared event never trips the check; a payload some serializer
        // mappings need more of may still be refused by the wire check, which
        // is a different refusal.
        try {
          await build(eventType, m.descriptor.type);
        } catch (err) {
          expect(err, `${m.descriptor.type} ${eventType}`).not.toBeInstanceOf(DescriptorViolationError);
          expect(err, `${m.descriptor.type} ${eventType}`).not.toBeInstanceOf(GrantRefusedError);
        }
      }
    }
  });
});
