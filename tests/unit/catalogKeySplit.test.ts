// The console split, step 2: the console signs plugin approvals with its
// private key; a hub deployment verifies with the public half alone
// (CIVIC_CATALOG_PUBLIC_KEY) and never holds the private key.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogKeys, signatureVerifies, TEST_KEY_PUBLIC } from "../../src/plugins/signature.js";
import { parseSigningKey, signRow } from "../../src/shared/catalogSignature.js";
import * as hubSignature from "../../src/plugins/signature.js";

const TEST_PEM = readFileSync(join(__dirname, "../fixtures/catalog/test-signing-key.pem"), "utf8");
const row = { package: "civic.wordcloud", version: "0.2.0", hash: `sha256:${"a".repeat(64)}`, capabilities: { tables: [], routes: [] } as never };

describe("a hub deployment with the console's public key only", () => {
  it("trusts that key and verifies what the console signed", () => {
    const consoleKey = parseSigningKey(TEST_PEM, false);
    const hub = catalogKeys({ mode: "required", publicKey: TEST_KEY_PUBLIC, production: false });
    expect(hub.primary).toEqual({ id: consoleKey.id, publicKey: TEST_KEY_PUBLIC });
    expect([...hub.trusted.keys()]).toEqual([consoleKey.id]);
    expect(signatureVerifies({ ...row, ...signRow(row, consoleKey) }, hub.trusted)).toBe(true);
    // Another version, the same signature: refused.
    expect(signatureVerifies({ ...row, version: "0.2.1", ...signRow(row, consoleKey) }, hub.trusted)).toBe(false);
  });

  it("prefers CIVIC_CATALOG_PUBLIC_KEY as the current key over a private key still set", () => {
    const other = catalogKeys({ mode: "transition", publicKey: TEST_KEY_PUBLIC, key: TEST_PEM, production: false });
    expect(other.primary?.publicKey).toBe(TEST_KEY_PUBLIC);
  });

  it("refuses the committed test key on a deployment, and a value that is not a key", () => {
    const prod = catalogKeys({ mode: "required", publicKey: TEST_KEY_PUBLIC, production: true });
    expect(prod.primary).toBeNull();
    expect(prod.trusted.size).toBe(0);
    expect(prod.problem).toContain("test key");
    expect(catalogKeys({ mode: "required", publicKey: "not-a-key", production: false }).problem).toContain("CIVIC_CATALOG_PUBLIC_KEY");
  });

  it("gives the hub nothing to sign with", () => {
    expect("signRow" in hubSignature).toBe(false);
  });
});
