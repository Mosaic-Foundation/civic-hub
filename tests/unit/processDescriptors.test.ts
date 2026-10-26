// Every registered process type's descriptor is well formed and agrees with
// its handler and with the hub's lists (src/processes/descriptorCheck.ts):
// its plugin, its states and transitions, its events (each mapped by the
// activity serializer), its tables (under row-level security and in the
// export), its creation, deadline, brief and approval. The conformance suite
// (kit/conformance/) proves the same things against a running hub; this is
// the part that needs no server, so it runs in CI on every push.

import { describe, expect, it } from "vitest";
import {
  getAllHandlers,
  getRegisteredTypes,
  PROCESS_TYPE_PLUGINS,
  processTypeDisplays,
  publicProcessTypes,
} from "../../src/processes/registry.js";
import { checkDescriptor } from "../../src/processes/descriptorCheck.js";
import { hostFacts } from "../../kit/conformance/src/hostFacts.js";

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

  it("every type has a pill label, and sections have distinct ids and default places", () => {
    const shown = processTypeDisplays();
    expect(shown.map((t) => t.type).sort()).toEqual(getRegisteredTypes().sort());
    const sections = shown.flatMap((t) => (t.section ? [t.section] : []));
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    expect(new Set(sections.map((s) => s.order)).size).toBe(sections.length);
    // Today's strip order is the default (Adam, 2026-10-14).
    expect([...sections].sort((a, b) => a.order - b.order).map((s) => s.label)).toEqual([
      "Conversations",
      "Proposals",
      "Votes",
      "Projects",
      "Outcomes",
    ]);
  });

  it("a display a resident could not read is named", () => {
    const vote = getAllHandlers().find((h) => h.type === "civic.vote")!;
    const broken = {
      ...vote,
      descriptor: {
        ...vote.descriptor,
        display: {
          label: "",
          plural: "",
          icon: "",
          section: { id: "Bad Id", label: "Two words", path: "votes", detail_paths: [], order: 1 },
        },
      },
    };
    const problems = checkDescriptor(broken, host);
    expect(problems).toContain("civic.vote: display has no label and plural (the feed's pill)");
    expect(problems).toContain("civic.vote: display has no icon key (unknown keys draw the generic icon)");
    expect(problems).toContain("civic.vote: display.section.id Bad Id must be lowercase letters, digits, - or _");
    expect(problems).toContain("civic.vote: display.section.path votes must start with /");
    expect(problems).toContain(`civic.vote: display.section's bar label "Two words" must be one word (set short)`);
  });
});
