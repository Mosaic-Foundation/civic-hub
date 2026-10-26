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

/** The grant a manifest declares: what its descriptor emits and its tables, nothing more. */
function capabilitiesFor(m: Pick<ProcessManifest, "descriptor" | "tables">): ProcessManifest["capabilities"] {
  return {
    activities: { emit: [...m.descriptor.emits], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: (m.tables ?? []).map((t) => t.name) },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page"] },
  };
}

function manifest(over: Partial<ProcessManifest> = {}): ProcessManifest {
  const m = {
    descriptor: descriptor(),
    color: "vote",
    detailPath: (id: string) => `/sample/${id}`,
    requiredSchema: [],
    tables: [{ name: "sample_rows", rows: "export", key: ["id"], holds: "sample rows" }],
    jobs: [],
    pluginSection: { order: 10, name: "Samples", what: "Sample processes.", fields: [] },
    activities: { "civic.sample.taken": { type: "Create", object: { kind: "note" } } },
    publicPayload: { "civic.sample.taken": ["sample"] },
    disclosure: "members",
    ...over,
  } as ProcessManifest;
  return "capabilities" in over ? m : { ...m, capabilities: capabilitiesFor(m) };
}

const refused = (ms: unknown[]) => () => checkManifests(ms, HOST);

describe("process manifests", () => {
  it("accepts a complete manifest", () => {
    expect(checkManifests([manifest()], HOST)).toHaveLength(1);
  });

  for (const field of ["descriptor", "color", "detailPath", "requiredSchema", "tables", "jobs", "activities"] as const) {
    it(`refuses a manifest missing "${field}", naming the type and the field`, () => {
      const m = manifest() as unknown as Record<string, unknown>;
      delete m[field];
      const name = field === "descriptor" ? "#1" : "civic.sample";
      expect(refused([m])).toThrow(`process manifest ${name}: missing "${field}"`);
    });
  }

  it("refuses a manifest without its capability grant, naming the type", () => {
    const m = manifest() as unknown as Record<string, unknown>;
    delete m.capabilities;
    expect(refused([m])).toThrow('process manifest civic.sample: missing "capabilities"');
  });

  it("refuses a grant that differs from what the manifest declares, or reaches past the rules", () => {
    const base = manifest();
    const caps = base.capabilities;
    const bad: Array<[Partial<ProcessManifest["capabilities"]>, string]> = [
      [{ activities: { emit: [], listen: [] } }, "activities.emit must equal its descriptor's emits"],
      [{ activities: { emit: ["civic.sample.*"], listen: [] } }, "no wildcards"],
      [{ activities: { emit: caps.activities.emit, listen: ["civic.vote.closed"] } }, "listen must be empty"],
      [{ state: { read: ["own-process"], write: ["own-process"], tables: ["sample_rows", "users"] } }, "state.tables must equal its manifest's tables"],
      [{ adapters: ["heartbeat"] as never }, "capabilities.adapters may name only"],
      [{ network: { egress: ["polis.example.org"] } }, "network.egress must be empty"],
      [{ identity: { claims: ["email"] as never } }, "identity.claims may name only"],
      [{ ui: { surfaces: ["admin-console"] as never } }, "ui.surfaces may name only"],
    ];
    for (const [over, message] of bad) {
      expect(refused([manifest({ capabilities: { ...caps, ...over } })])).toThrow(message);
    }
    const tier3 = manifest({ descriptor: descriptor({ tier: 3 }) });
    expect(refused([tier3])).toThrow("a Tier 3 type reaches its outside service through an adapter");
  });

  it("refuses a table without its plain-words description", () => {
    expect(refused([manifest({ tables: [{ name: "sample_rows", rows: "export", key: ["id"], holds: " " }] })]))
      .toThrow('table sample_rows needs "holds"');
  });

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
    expect(refused([manifest({ tables: [{ name: "events", rows: "export", key: ["id"], holds: "rows" }] })])).toThrow("table events is already owned");
    expect(refused([manifest({ tables: [{ name: "sample_rows", rows: "export", key: [], holds: "rows" }] })])).toThrow("has no primary key");
    expect(refused([manifest({ tables: [{ name: "sample_rows", rows: "omit", key: ["id"], holds: "rows" }] })])).toThrow("without a reason");
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

  it("refuses a publication without a field or with an unknown queue", () => {
    expect(refused([manifest({ publication: { field: "", queue: "briefs" } })])).toThrow("publication.field is empty");
    expect(refused([manifest({ publication: { field: "s", queue: "nope" as never } })])).toThrow("publication.queue must be");
  });

  it("refuses a setting outside the plugin's keys", () => {
    expect(refused([manifest({ pluginSection: { order: 1, name: "Samples", what: "Sample processes.", fields: [{ key: "plugin.digest.x", kind: "boolean" }] } })]))
      .toThrow("setting plugin.digest.x is not under plugin.vote.");
  });

  it("refuses a missing publicPayload, so no type ships without deciding its public shape", () => {
    expect(refused([manifest({ publicPayload: undefined as never })])).toThrow('missing "publicPayload"');
  });

  it("refuses a publicPayload entry for an event the type neither emits nor maps", () => {
    expect(refused([manifest({ publicPayload: { "civic.other.thing": ["x"] } })]))
      .toThrow("publicPayload declares civic.other.thing, which the type neither emits nor maps");
  });

  it("refuses 'process' in a publicPayload entry — it is always public, never repeated", () => {
    expect(refused([manifest({ publicPayload: { "civic.sample.taken": ["process"] } })]))
      .toThrow('publicPayload.civic.sample.taken must list non-empty payload keys');
  });

  it("accepts a publicPayload entry for a host lifecycle type the descriptor does not list", () => {
    expect(refused([manifest({ publicPayload: { "civic.process.created": ["sample"] } })])).not.toThrow();
  });

  it("accepts no eligibility (the hub's rule) or a list of credential types, with alternatives", () => {
    expect(refused([manifest({ eligibility: { requirements: ["resident.county"] } })])).not.toThrow();
    expect(refused([manifest({ eligibility: { requirements: ["proof_of_personhood", ["resident.city", "resident.county"]] } })])).not.toThrow();
  });

  it("refuses an empty or malformed eligibility declaration", () => {
    for (const requirements of [[], [""], [[]], [["ok", ""]], [3]] as unknown[]) {
      expect(refused([manifest({ eligibility: { requirements } as never })])).toThrow("eligibility.requirements must be a non-empty list");
    }
  });

  it("derives the resident allowlist from the actions' callers", () => {
    expect(residentActions(manifest())).toEqual(["sample.take"]);
  });
});
