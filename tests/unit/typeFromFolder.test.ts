// A new process type is one folder and nothing else (engine 2, B9): add a
// type from its folder alone (the SDK tour, kit/conformance/fixtures/
// sdk-tour, as if config/plugins.json listed it) and it reaches every list a
// type used to join by hand.
//
// Tripwire tests that count types (pluginRoutes, navSections, the parity
// fixture, the leak harness's plans and others; TESTING.md lists them) stay
// hand lists on purpose: a new type changes them, and the diff says how.

import { beforeAll, describe, expect, it, vi } from "vitest";
import tour from "../../kit/conformance/fixtures/sdk-tour/manifest.js";

// The configured list with the tour appended, as `plugins:sync` would write
// it; every module that reads the list is loaded afresh after.
beforeAll(async () => {
  const real = (await import("../../config/plugins/manifests.js")) as { PACKAGE_MANIFESTS: readonly unknown[]; PACKAGE_ENTRIES: readonly unknown[] };
  vi.resetModules();
  vi.doMock("../../config/plugins/manifests.js", () => ({
    ...real,
    PACKAGE_MANIFESTS: [...real.PACKAGE_MANIFESTS, tour],
    PACKAGE_ENTRIES: [...real.PACKAGE_ENTRIES, { dir: "kit/conformance/fixtures/sdk-tour", name: "@civic-social-examples/plugin-sdk-tour", manifest: tour }],
  }));
});

describe("a type added from its folder alone", () => {
  it("classifies its tables for sample content", async () => {
    const s = await import("../../src/models/sampleContent.js");
    expect(s.PROCESS_CHILD_COLUMNS.sdk_tour_marks).toEqual(["process_id"]);
    expect(s.PROCESS_CHILD_COLUMNS.sdk_tour_places).toEqual(["process_id"]);
    expect(s.NOT_PROCESS_CONTENT.sdk_tour_drafts).toMatch(/draft/);
    expect(s.PARTICIPATION_TABLES.find((t) => t.table === "sdk_tour_joins")).toMatchObject({ userColumn: "user_id", kind: "join" });
    expect(s.NOT_PARTICIPATION.sdk_tour_places).toBeTruthy();
    const { DECLARED_KIND_NOUNS } = await import("../../src/shared/sampleKinds.js");
    expect(DECLARED_KIND_NOUNS.join).toEqual(["person on a tour", "people on tours"]);
  });

  it("brings its card kind, colour and digest section", async () => {
    const { DECLARED_FEED_KINDS } = await import("../../src/shared/feedActivity.js");
    expect(DECLARED_FEED_KINDS.get("sdk-tour")?.type).toBe("example.sdk_tour");
    const theme = await import("../../src/shared/theme.js");
    expect(theme.THEME_TYPE_KEYS).toContain("sdk-tour");
    expect(theme.themeTypeLabel("sdk-tour")).toBe("SDK tour");
    expect(theme.declaredTypeStylesheet()).toContain(".feed-pill--type-sdk-tour{");
  });

  it("gets its section in the navigation", async () => {
    const { orderedSections } = await import("../../src/shared/navSections.js");
    const types = [{ type: "example.sdk_tour", plugin: "sdk_tour", label: "SDK tour", plural: "SDK tours", icon: "map", section: tour.descriptor.display.section }];
    const sections = orderedSections({ types: types as never, enabled: () => true, order: [] });
    expect(sections.map((s) => s.id)).toContain("sdk-tours");
  });

  it("gets its share-card route and its help note from plugins:sync", async () => {
    const { derivedFiles } = await import("../../scripts/plugins-sync.js");
    const written = new Map(derivedFiles([tour as never]));
    const vercel = JSON.parse(written.get("vercel.json")!) as { rewrites: Array<{ source: string; destination: string }> };
    expect(vercel.rewrites.filter((r) => r.destination === "/api/og").map((r) => r.source)).toContain("/sdk-tour/:id*");
    const help = JSON.parse(written.get("src/shared/helpRegistry.json")!) as Record<string, { anchor: string; pending?: boolean }>;
    expect(help["plugins.sdk_tour"]).toMatchObject({ anchor: "plugins-sdk-tour", pending: true });
  });

  it("is checked at startup like any other, and the registry knows it", async () => {
    const { getManifest } = await import("../../src/processes/registry.js");
    expect(getManifest("example.sdk_tour")?.descriptor.display.label).toBe("SDK tour");
  });
});
