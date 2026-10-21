/**
 * The manifest checker (src/processes/manifest.ts): a type with a missing or
 * wrong field is refused at startup with a message naming the type and the
 * field (Architecture 2, ADR-009).
 */
import { describe, it, expect } from "vitest";
import {
  checkManifests,
  residentActions,
  type ManifestHostFacts,
  type ProcessManifest,
} from "../../src/processes/manifest.js";
import type { ProcessTypeDescriptor } from "../../src/processes/descriptor.js";

const HOST: ManifestHostFacts = {
  colors: ["vote", "brief"],
  hostActivityTypes: ["civic.process.created"],
  hostTables: ["processes", "events"],
  featureIds: ["digest"],
};

function descriptor(over: Partial<ProcessTypeDescriptor> = {}): ProcessTypeDescriptor {
  return {
    type: "civic.sample",
    version: "0.1",
    tier: 1,
    plugin: "vote",
    states: ["active", "closed"],
    initial_status: "active",
    actions: [
      { name: "sample.take", description: "", callers: ["resident", "admin"], from: ["active"], to: null, emits: [] },
      { name: "sample.close", description: "", callers: ["admin", "system"], from: ["active"], to: "closed", emits: [] },
    ],
    emits: ["civic.sample.taken"],
    creation: { resident: null, admin: true, system: false },
    deadline: null,
    brief: false,
    tables: ["sample_rows"],
    outside_services: [],
    examples: {},
    display: { label: "Sample", plural: "Samples", icon: "generic" },
    ...over,
  };
}

function manifest(over: Partial<ProcessManifest> = {}): ProcessManifest {
  return {
    descriptor: descriptor(),
    color: "vote",
    detailPath: (id) => `/sample/${id}`,
    requiredSchema: [],
    tables: [{ name: "sample_rows", rows: "export", key: ["id"] }],
    jobs: [],
    pluginSection: { order: 10, fields: [] },
    activities: { "civic.sample.taken": { type: "Create", object: { kind: "note" } } },
    publicListing: "always",
    ...over,
  };
}

const refused = (ms: unknown[]) => () => checkManifests(ms, HOST);

describe("process manifests", () => {
  it("accepts a complete manifest", () => {
    expect(checkManifests([manifest()], HOST)).toHaveLength(1);
  });

  for (const field of ["descriptor", "color", "detailPath", "requiredSchema", "tables", "jobs", "activities", "publicListing"] as const) {
    it(`refuses a manifest missing "${field}", naming the type and the field`, () => {
      const m = manifest() as unknown as Record<string, unknown>;
      delete m[field];
      const name = field === "descriptor" ? "#1" : "civic.sample";
      expect(refused([m])).toThrow(`process manifest ${name}: missing "${field}"`);
    });
  }

  it("refuses two manifests of one type", () => {
    expect(refused([manifest(), manifest({ pluginSection: undefined, tables: [], descriptor: descriptor({ tables: [] }) })]))
      .toThrow("civic.sample: a second manifest declares this type");
  });

  it("refuses a hub feature as a process plugin", () => {
    expect(refused([manifest({ descriptor: descriptor({ plugin: "digest" }) })])).toThrow('plugin "digest" is a hub feature');
  });

  it("refuses a colour the theme does not have", () => {
    expect(refused([manifest({ color: "teal" as never })])).toThrow('color "teal" is not a theme colour');
  });

  it("refuses a detail path that drops the id", () => {
    expect(refused([manifest({ detailPath: () => "/sample" })])).toThrow("detailPath(id) must return a path containing the id");
  });

  it("refuses a table another owner has, one without a key, and an omitted one without a reason", () => {
    expect(refused([manifest({ tables: [{ name: "events", rows: "export", key: ["id"] }] })])).toThrow("table events is already owned");
    expect(refused([manifest({ tables: [{ name: "sample_rows", rows: "export", key: [] }] })])).toThrow("has no primary key");
    expect(refused([manifest({ tables: [{ name: "sample_rows", rows: "omit", key: ["id"] }] })])).toThrow("without a reason");
  });

  it("refuses live tables that differ from the descriptor's", () => {
    expect(refused([manifest({ descriptor: descriptor({ tables: [] }) })])).toThrow("descriptor.tables () and its live tables (sample_rows) differ");
  });

  it("refuses a job of another plugin", () => {
    const job = { id: "j", plugin: "proposal" as const, path: "/j", schedule: "0 * * * *", description: "" };
    expect(refused([manifest({ jobs: [job] })])).toThrow("job j belongs to plugin proposal, not vote");
  });

  it("refuses an event mapped twice, or mapped but not emitted", () => {
    expect(refused([manifest({ activities: { "civic.process.created": { type: "Create", object: { kind: "note" } } } })]))
      .toThrow("civic.process.created is already mapped");
    expect(refused([manifest({ activities: { "civic.sample.other": { type: "Create", object: { kind: "note" } } } })]))
      .toThrow("maps civic.sample.other, which its descriptor does not emit");
  });

  it("refuses a plugin no manifest carries the section of, or two that do", () => {
    expect(refused([manifest({ pluginSection: undefined })])).toThrow("process plugin vote: no manifest carries its pluginSection");
    const second = manifest({ descriptor: descriptor({ type: "civic.other", tables: [] }), tables: [], activities: {} });
    expect(refused([manifest(), second])).toThrow("plugin vote's section is already carried by civic.sample");
  });

  it("refuses a setting outside the plugin's keys", () => {
    expect(refused([manifest({ pluginSection: { order: 1, fields: [{ key: "plugin.digest.x", kind: "boolean" }] } })]))
      .toThrow("setting plugin.digest.x is not under plugin.vote.");
  });

  it("derives the resident allowlist from the actions' callers", () => {
    expect(residentActions(manifest())).toEqual(["sample.take"]);
  });
});
