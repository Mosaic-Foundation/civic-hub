/**
 * The plugin loader (src/plugins/loader.ts; ADR-014): a package that is not
 * well formed is refused at startup with a message naming it, and a package
 * is mounted only when an approved catalog row records the exact hash of its
 * files and a grant no smaller than its manifest asks for.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { judge, loadPackages, loadedPackages } from "../../src/plugins/loader.js";
import { hashPackage } from "../../src/plugins/hash.js";
import type { CatalogRow } from "../../src/db/pluginCatalog.js";
import type { ConfiguredPackage, PluginPackage } from "../../src/plugins/package.js";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { catalogKeys, parseSigningKey, signRow, TEST_KEY_PUBLIC } from "../../src/plugins/signature.js";

const real = loadedPackages().find((p) => p.pkg.name === "@civic-social/plugin-wordcloud")!;

/** A configured entry like the word cloud's, with some fields replaced. */
function entry(over: Partial<Record<keyof PluginPackage, unknown>>, dir = "packages/civic.test"): ConfiguredPackage {
  return { dir, files: [], pkg: { ...real.pkg, name: "@test/plugin-sample", ...over } as PluginPackage };
}

describe("package validation at startup", () => {
  it("refuses a package without a display name, naming it", () => {
    expect(() => loadPackages([entry({ displayName: "" })])).toThrow(
      'plugin package @test/plugin-sample (packages/civic.test): missing "displayName"',
    );
  });

  it("refuses a manifest without its grant, naming the package", () => {
    const manifest = { ...real.pkg.manifest, capabilities: undefined };
    expect(() => loadPackages([entry({ manifest })])).toThrow(
      'plugin package @test/plugin-sample (packages/civic.test): its manifest has no "capabilities"',
    );
  });

  it("refuses a malformed name or version, a missing requirement, a handler of another type, and a job without its runner", () => {
    expect(() => loadPackages([entry({ name: "sample" })])).toThrow('plugin package sample (packages/civic.test): missing or malformed "name"');
    expect(() => loadPackages([entry({ version: "1.0" })])).toThrow('missing or malformed "version"');
    expect(() => loadPackages([entry({ requires: ["@test/absent"] })])).toThrow("requires @test/absent, which config/plugins.json does not list");
    expect(() => loadPackages([entry({ server: () => ({ handler: { ...real.server.handler, type: "civic.other" } }) })])).toThrow(
      "its handler is for civic.other, its manifest for civic.wordcloud",
    );
    const manifest = { ...real.pkg.manifest, jobs: [{ id: "sample_job", plugin: "wordcloud", path: "/x", schedule: "0 * * * *", description: "x" }] };
    expect(() => loadPackages([entry({ manifest, server: () => ({ handler: real.server.handler }) })])).toThrow(
      "its manifest declares jobs [sample_job] and server(host) runs []",
    );
  });

  it("refuses two packages of one name", () => {
    expect(() => loadPackages([entry({}), entry({}, "packages/civic.test2")])).toThrow("a second package has this name");
  });
});

describe("what is mounted", () => {
  // Hash and grant alone (signatures have their own cases below), whatever this process's settings say.
  const hashOnly = catalogKeys({ mode: "transition", production: false });
  const hash = "sha256:" + "a".repeat(64);
  const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
    id: "c1",
    package: real.pkg.name,
    version: real.pkg.version,
    hash,
    display_name: real.pkg.displayName,
    plugin: real.plugin,
    process_type: real.type,
    capabilities: real.pkg.manifest.capabilities,
    conformance: { result: "passed", ran_at: "2026-10-25T00:00:00Z" },
    status: "approved",
    approved_by: "operator@example.test",
    approved_at: "2026-10-25T00:00:00Z",
    withdrawn_at: null,
    notes: null,
    created_at: "2026-10-25T00:00:00Z",
    signature: null,
    signature_key: null,
    signed_at: null,
    ...over,
  });

  it("mounts a package whose files match an approved row", () => {
    expect(judge(real, hash, [row()], hashOnly)).toMatchObject({ mounted: true, hash });
  });

  it("does not mount a package with no approved row for its version", () => {
    const v = judge(real, hash, [row({ version: "9.9.9" })], hashOnly);
    expect(v.mounted).toBe(false);
    expect(v.reason).toContain("no approved catalog entry for this version");
  });

  it("does not mount a package whose code changed after its approval", () => {
    const v = judge(real, "sha256:" + "b".repeat(64), [row()], hashOnly);
    expect(v.mounted).toBe(false);
    expect(v.reason).toContain("its files changed since this version was approved");
  });

  it("does not mount a package that asks for more than its approved grant", () => {
    const caps = real.pkg.manifest.capabilities;
    const narrower = { ...caps, state: { ...caps.state, tables: [] } };
    const v = judge(real, hash, [row({ capabilities: narrower })], hashOnly);
    expect(v.mounted).toBe(false);
    expect(v.reason).toBe("it asks for more than its approved grant: table wordcloud_submissions");
  });

  it("does not mount a package whose files could not be read", () => {
    expect(judge(real, new Error("ENOENT"), [row()], hashOnly)).toMatchObject({ mounted: false });
  });
});

describe("signed approvals (plugin session 2, ADR-015)", () => {
  const hash = "sha256:" + "c".repeat(64);
  const TEST_PEM = readFileSync("tests/fixtures/catalog/test-signing-key.pem", "utf8");
  const otherPem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const base: CatalogRow = {
    id: "c1",
    package: real.pkg.name,
    version: real.pkg.version,
    hash,
    display_name: real.pkg.displayName,
    plugin: real.plugin,
    process_type: real.type,
    capabilities: real.pkg.manifest.capabilities,
    conformance: { result: "passed", ran_at: "2026-10-25T00:00:00Z" },
    status: "approved",
    approved_by: "operator@example.test",
    approved_at: "2026-10-25T00:00:00Z",
    withdrawn_at: null,
    notes: null,
    created_at: "2026-10-25T00:00:00Z",
    signature: null,
    signature_key: null,
    signed_at: null,
  };
  const signedBy = (pem: string, over: Partial<CatalogRow> = {}): CatalogRow => {
    const row = { ...base, ...over };
    return { ...row, ...signRow(row, parseSigningKey(pem, false)), signed_at: "2026-10-26T00:00:00Z" };
  };
  const keys = (mode: string, key?: string, trusted?: string) => catalogKeys({ mode, key, trusted, production: false });

  it("transition, no key on this deployment: hash-only, signed or not", () => {
    expect(judge(real, hash, [base], keys("transition"))).toMatchObject({ mounted: true, signed: false });
    expect(judge(real, hash, [signedBy(TEST_PEM)], keys("transition"))).toMatchObject({ mounted: true, signed: false });
  });

  it("transition, with the key: a signed row must verify; an unsigned one still mounts on its hash", () => {
    const k = keys("transition", TEST_PEM);
    expect(judge(real, hash, [signedBy(TEST_PEM)], k)).toMatchObject({ mounted: true, signed: true });
    expect(judge(real, hash, [base], k)).toMatchObject({ mounted: true, signed: false });
    const forged = { ...signedBy(otherPem), signature_key: signedBy(TEST_PEM).signature_key };
    expect(judge(real, hash, [forged], k)).toMatchObject({ mounted: false, reason: expect.stringContaining("does not verify") });
  });

  it("required: a row without a valid signature is unapproved", () => {
    const k = keys("required", TEST_PEM);
    expect(judge(real, hash, [signedBy(TEST_PEM)], k)).toMatchObject({ mounted: true, signed: true });
    expect(judge(real, hash, [base], k)).toMatchObject({ mounted: false, reason: expect.stringContaining("not signed") });
    // Anything signed changed afterwards: the grant widened, the hash swapped.
    const widened = { ...signedBy(TEST_PEM), capabilities: { ...base.capabilities, adapters: ["ai" as const] } };
    expect(judge(real, hash, [widened], k).mounted).toBe(false);
    const otherHash = "sha256:" + "d".repeat(64);
    const swapped = { ...signedBy(TEST_PEM), hash: otherHash };
    expect(judge(real, otherHash, [swapped], k)).toMatchObject({ mounted: false, reason: expect.stringContaining("does not verify") });
    // Signed by a key this deployment does not trust.
    expect(judge(real, hash, [signedBy(otherPem)], k).mounted).toBe(false);
  });

  it("required, no key on this deployment: nothing mounts, and it says which setting", () => {
    const v = judge(real, hash, [signedBy(TEST_PEM)], keys("required"));
    expect(v.mounted).toBe(false);
    expect(v.reason).toContain("CIVIC_CATALOG_SIGNING_KEY");
    // An unknown mode is read as required.
    expect(catalogKeys({ mode: "sometimes", production: false }).mode).toBe("required");
  });

  it("a tampered package is not mounted, whatever its row's signature", () => {
    const v = judge(real, "sha256:" + "e".repeat(64), [signedBy(TEST_PEM)], keys("required", TEST_PEM));
    expect(v.mounted).toBe(false);
    expect(v.reason).toContain("its files changed since this version was approved");
  });

  it("rotation: a retired key's signatures verify while it is trusted, and not after", () => {
    const retired = parseSigningKey(TEST_PEM, false);
    const row = signedBy(TEST_PEM);
    expect(judge(real, hash, [row], keys("required", otherPem, retired.publicKey)).mounted).toBe(true);
    expect(judge(real, hash, [row], keys("required", otherPem)).mounted).toBe(false);
  });

  it("the committed test key is refused on a deployment", () => {
    expect(parseSigningKey(TEST_PEM, false).publicKey).toBe(TEST_KEY_PUBLIC);
    expect(() => parseSigningKey(TEST_PEM, true)).toThrow("the committed test key");
    const onDeployment = catalogKeys({ mode: "required", key: TEST_PEM, trusted: TEST_KEY_PUBLIC, production: true });
    expect(onDeployment.signing).toBeNull();
    expect(onDeployment.trusted.size).toBe(0);
    expect(onDeployment.problem).toContain("the committed test key");
  });

  it("a key id names the key; a base64 PEM reads as the PEM", () => {
    const k = parseSigningKey(TEST_PEM, false);
    expect(k.id).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(parseSigningKey(Buffer.from(TEST_PEM).toString("base64"), false).id).toBe(k.id);
  });
});

describe("the content hash", () => {
  it("changes when any file of the package changes, and only then", () => {
    const dir = mkdtempSync(join(tmpdir(), "civic-pkg-"));
    mkdirSync(join(dir, "migrations"));
    writeFileSync(join(dir, "index.ts"), "export default {};\n");
    writeFileSync(join(dir, "migrations", "20261025000000_x.sql"), "select 1;\n");
    const first = hashPackage(dir);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashPackage(dir)).toBe(first);
    writeFileSync(join(dir, "migrations", "20261025000000_x.sql"), "select 2;\n");
    expect(hashPackage(dir)).not.toBe(first);
  });

  it("covers exactly the files plugins:sync listed: a host's own files beside them do not change it", () => {
    const dir = mkdtempSync(join(tmpdir(), "civic-pkg-"));
    writeFileSync(join(dir, "index.ts"), "export default {};\n");
    writeFileSync(join(dir, "handler.ts"), "export const x = 1;\n");
    const listed = ["handler.ts", "index.ts"];
    const before = hashPackage(dir, listed);
    expect(before).toBe(hashPackage(dir));
    // What Vercel ships beside the sources it was given: compiled output.
    writeFileSync(join(dir, "handler.js"), "export const x = 1;\n");
    expect(hashPackage(dir, listed)).toBe(before);
    expect(() => hashPackage(dir, [...listed, "gone.ts"])).toThrow();
  });
});
