import { describe, expect, it, vi } from "vitest";

/**
 * The drafting assistant coaches from the hub's own documents.
 *
 * Until 2026-09-24 it carried Floyd's Code of Conduct and Floyd's proposal
 * guide as string constants, and a hub name and community line that named
 * Floyd — on every hub. The embedded Code of Conduct had also drifted a
 * version behind the published one, so the automated check was enforcing a
 * code residents could not read. Now both documents are resolved per hub,
 * from the same source the public pages render.
 */

// Stand-in for each hub's own document rows. Athens has authored its own Code
// of Conduct and proposal guide; Floyd has its own guide only.
const ROWS: Record<string, Record<string, string>> = {
  athens: {
    "legal.code_of_conduct": "# Code of Conduct\n\nThe {HUB_NAME} is a demo. Be decent.",
    "legal.proposal_best_practices": "# Athens guide\n\nPropose things for the Town of Athens.",
  },
  floyd: {
    "legal.proposal_best_practices": "# Floyd guide\n\nSomething about the farmers market.",
  },
};

vi.mock("../../src/db/hubSettingsStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/hubSettingsStore.js")>()),
  fetchHubDocuments: async (hubId: string) => ROWS[hubId] ?? {},
}));

const { runWithHub } = await import("../../src/config/hubContext.js");
const { getHubConfig } = await import("../../src/modules/civic.assistant/service.js");
const { hubDocument } = await import("../../src/services/hubDocuments.js");
const { ATHENS_HUB, FLOYD_HUB } = await import("../fixtures/hubs/index.js");

describe("getHubConfig — the hub's name, place and Code of Conduct", () => {
  it("gives Athens its own, and names Floyd nowhere", async () => {
    const cfg = await runWithHub(ATHENS_HUB, { "identity.name": "Athens Civic Hub (demo)" }, getHubConfig);
    expect(cfg.hub_name).toBe("Athens Civic Hub (demo)");
    expect(cfg.community_description).toBe("residents of Town of Athens, Virginia");
    expect(cfg.code_of_conduct).toContain("The Athens Civic Hub (demo) is a demo.");
    expect(JSON.stringify(cfg)).not.toMatch(/floyd/i);
  });

  it("gives Floyd the shared Code of Conduct with Floyd's names, as its page renders it", async () => {
    const cfg = await runWithHub(
      FLOYD_HUB,
      {
        "copy.governing_body_name": "Board of Supervisors",
        "legal.operator_name": "Adam Lake",
        "legal.contact_email": "contact@civic.social",
      },
      getHubConfig,
    );
    expect(cfg.hub_name).toBe("Floyd Civic Hub");
    expect(cfg.community_description).toBe("residents of Floyd County, Virginia");
    expect(cfg.code_of_conduct).toContain("decorum, not opinion");
    expect(cfg.code_of_conduct).toContain("Floyd");
    expect(cfg.code_of_conduct).not.toMatch(/\{[A-Z_]+\}/);
  });
});

describe("the proposal guide is the hub's document", () => {
  it("resolves each hub's own guide", async () => {
    const athens = await runWithHub(ATHENS_HUB, {}, () =>
      hubDocument(ATHENS_HUB, "legal.proposal_best_practices"),
    );
    const floyd = await runWithHub(FLOYD_HUB, {}, () =>
      hubDocument(FLOYD_HUB, "legal.proposal_best_practices"),
    );
    expect(athens).toContain("Athens guide");
    expect(floyd).toContain("Floyd guide");
  });

  it("is declared by the proposal type rather than compiled into it", async () => {
    const { proposalAssistantConfig } = await import("../../src/processes/proposalAssistantConfig.js");
    expect(proposalAssistantConfig.bestPracticesDocument).toBe("legal.proposal_best_practices");
    expect(proposalAssistantConfig.bestPractices).not.toMatch(/floyd/i);
  });
});
