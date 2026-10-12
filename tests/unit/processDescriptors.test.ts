// Every registered process type's descriptor is well formed and agrees with
// its handler and with the hub's lists (src/processes/descriptorCheck.ts):
// its plugin, its states and transitions, its events (each mapped by the
// activity serializer), its tables (under row-level security and in the
// export), its creation, deadline, brief and approval. The conformance suite
// (tests/conformance/) proves the same things against a running hub; this is
// the part that needs no server, so it runs in CI on every push.

import { describe, expect, it } from "vitest";
import { getAllHandlers, getRegisteredTypes, PROCESS_TYPE_PLUGINS, publicProcessTypes } from "../../src/processes/registry.js";
import { checkDescriptor } from "../../src/processes/descriptorCheck.js";
import { hostFacts } from "../conformance/hostFacts.js";

const host = hostFacts();

describe("process type descriptors", () => {
  for (const handler of getAllHandlers()) {
    it(`${handler.type} conforms`, () => {
      expect(checkDescriptor(handler, host)).toEqual([]);
    });
  }

  it("every registered type's plugin comes from its descriptor", () => {
    expect(Object.keys(PROCESS_TYPE_PLUGINS).sort()).toEqual(getRegisteredTypes().sort());
  });

  it("the public parts carry no tables, settings or adapters", () => {
    const served = JSON.stringify(publicProcessTypes(() => true));
    for (const handler of getAllHandlers()) {
      for (const table of handler.descriptor.tables) expect(served).not.toContain(`"${table}"`);
      for (const service of handler.descriptor.outside_services) {
        expect(served).not.toContain(service.adapter);
        expect(served).not.toContain(service.egress_setting);
      }
    }
  });

  it("a descriptor that disagrees with its handler is named", () => {
    const vote = getAllHandlers().find((h) => h.type === "civic.vote")!;
    const broken = {
      ...vote,
      descriptor: {
        ...vote.descriptor,
        emits: [...vote.descriptor.emits, "civic.process.not_a_thing"],
        deadline: null,
        tier: 2 as const,
      },
    };
    const problems = checkDescriptor(broken, host);
    expect(problems).toContain("civic.vote: emits civic.process.not_a_thing, which the activity serializer does not map");
    expect(problems).toContain(
      "civic.vote: the handler closes at a deadline (closeIfExpired) but the descriptor declares none",
    );
    expect(problems).toContain(
      "civic.vote: declares tier 2 (sandboxed); no sandbox runtime exists yet, so it cannot run here",
    );
  });
});
