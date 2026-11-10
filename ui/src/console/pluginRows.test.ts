import { describe, expect, it } from "vitest";
import { compareVersionsDesc, pluginRows } from "./pluginRows";
import type { PluginCatalogEntry, PluginVerdict } from "./api";

const PKG = "@civic-social/plugin-event";

function entry(version: string, status: PluginCatalogEntry["status"], more: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry {
  return {
    id: `${version}-${status}`,
    package: PKG,
    version,
    hash: `sha256:${version}`,
    display_name: "Events",
    plugin: "event",
    process_type: "civic.event",
    conformance: { result: "passed", ran_at: "2026-11-01T00:00:00Z" },
    status,
    approved_by: null,
    approved_at: null,
    withdrawn_at: null,
    notes: null,
    created_at: "2026-11-01T00:00:00Z",
    matches_deployment: false,
    grant: { can: [], cannot: [] },
    signature_key: null,
    signed_at: null,
    signed: false,
    required: false,
    auto_install: true,
    ...more,
  };
}

const running: PluginVerdict = { package: PKG, version: "0.4.4", type: "civic.event", plugin: "event", hash: "sha256:0.4.4", mounted: true };

describe("version order", () => {
  it("is newest first, numbers as numbers, a pre-release before its release", () => {
    const v = ["0.4.2", "0.10.0", "0.4.10", "1.0.0-beta.2", "1.0.0", "0.4.4"].sort(compareVersionsDesc);
    expect(v).toEqual(["1.0.0", "1.0.0-beta.2", "0.10.0", "0.4.10", "0.4.4", "0.4.2"]);
  });
});

describe("one row per plugin", () => {
  it("groups a plugin's three versions, newest first, marking the one running and the one waiting", () => {
    const rows = pluginRows([entry("0.4.2", "withdrawn"), entry("0.4.5", "pending"), entry("0.4.4", "approved")], [running]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.versions.map((e) => e.version)).toEqual(["0.4.5", "0.4.4", "0.4.2"]);
    expect(row!.running?.version).toBe("0.4.4");
    expect(row!.pending?.version).toBe("0.4.5");
  });

  it("offers no Approve for a pending version older than an approved one", () => {
    const [row] = pluginRows([entry("0.4.3", "pending"), entry("0.4.4", "approved")], [running]);
    expect(row!.pending).toBeNull();
    expect(row!.versions).toHaveLength(2);
  });

  it("runs nothing when the deployment does not mount it, and keeps a package with no entry", () => {
    const rows = pluginRows([entry("0.4.4", "approved")], [
      { ...running, mounted: false, reason: "no approved entry" },
      { package: "@civic-social/plugin-vote", version: "0.3.0", type: "civic.vote", plugin: "vote", hash: null, mounted: false, reason: "no entry" },
    ]);
    expect(rows.map((r) => r.package)).toEqual([PKG, "@civic-social/plugin-vote"]);
    expect(rows[0]!.running).toBeNull();
    expect(rows[1]!.versions).toEqual([]);
  });
});
