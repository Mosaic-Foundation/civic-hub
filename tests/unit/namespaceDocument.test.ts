/**
 * The software-level namespace document (ADR-008). The website publishes
 * config/ns/civic-hub.jsonld at https://www.civic.social/ns/civic-hub; this
 * fails when the copy no longer matches the term register, so a new term is
 * never emitted under a namespace that does not declare it.
 *
 * To refresh the copy after adding a term:
 *   npx tsx -e 'import("./src/events/namespaceDocument.ts").then(m => process.stdout.write(JSON.stringify(m.softwareNamespaceDocument(), null, 2) + "\n"))' > config/ns/civic-hub.jsonld
 * then publish it on the website.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { softwareNamespaceDocument } from "../../src/events/namespaceDocument.js";
import { HUB_EXTENSION_NS } from "../../src/events/activitySerializer.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("software namespace document", () => {
  it("the committed copy matches the term register", () => {
    const committed = readFileSync(join(here, "../../config/ns/civic-hub.jsonld"), "utf8");
    expect(committed).toBe(JSON.stringify(softwareNamespaceDocument(), null, 2) + "\n");
  });

  it("names itself and maps hub: to the namespace activities declare", () => {
    const doc = softwareNamespaceDocument();
    expect(doc["@id"]).toBe(HUB_EXTENSION_NS);
    expect((doc["@context"] as { hub: string }).hub).toBe(HUB_EXTENSION_NS);
  });
});
