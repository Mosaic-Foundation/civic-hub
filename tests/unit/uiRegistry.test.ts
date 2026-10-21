import { describe, expect, it } from "vitest";
import { MANIFEST_LIST } from "../../src/shared/processManifests.js";

const { PROCESS_UI, processUiOf, feedKindUi } = await import("../../ui/src/processes/index.js");

describe("the UI contribution registry", () => {
  it("has one module per manifest, in manifest order", () => {
    expect(PROCESS_UI.map((u) => u.type)).toEqual(MANIFEST_LIST.map((m) => m.descriptor.type));
    for (const m of MANIFEST_LIST) expect(processUiOf(m.descriptor.type)?.type).toBe(m.descriptor.type);
  });

  it("gives every feed kind a manifest declares to exactly one module", () => {
    for (const m of MANIFEST_LIST) {
      for (const rule of m.feed?.cards ?? []) {
        const card = rule.card;
        if (typeof card === "string") continue;
        expect(feedKindUi(card.kind), `${m.descriptor.type}: ${card.kind}`).toBeDefined();
      }
    }
  });

  it("offers a settings panel only on the type that carries its plugin's section", () => {
    for (const ui of PROCESS_UI) {
      const m = MANIFEST_LIST.find((x) => x.descriptor.type === ui.type)!;
      if (ui.settingsPanel) expect(m.pluginSection, ui.type).toBeDefined();
    }
  });
});
