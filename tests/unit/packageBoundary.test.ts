// civic/package-boundary (eslint.config.js; ADR-014): a plugin package
// reaches the hub only through the SDK, src/shared/, its own files and the
// packages it requires; its manifest only src/shared/ and the manifest
// contract; the engine never imports a package, except the files the list
// names, and that list only shrinks. Linted as planted files of this repo,
// through the repo's config.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
// @ts-expect-error eslint.config.js is plain JavaScript with no declarations.
import { PACKAGE_REACH_NOT_YET as NOT_YET } from "../../eslint.config.js";

const PACKAGE_REACH_NOT_YET = NOT_YET as Record<string, string>;

const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/package-boundary").map((m) => m.message);
}

describe("civic/package-boundary", () => {
  it("lets a package import the SDK, shared data, its own files, node: and express", async () => {
    for (const code of [
      `import { emitEvent } from "../../src/sdk/index.js";`,
      `import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";`,
      `import { x } from "./service.js";`,
      `import { createHash } from "node:crypto";`,
      `import { Router } from "express";`,
    ]) {
      expect(await errors("packages/civic.wordcloud/x.ts", code), code).toHaveLength(0);
    }
  });

  it("refuses a package reaching the hub around the SDK: the database, an adapter, a service, the hosting layer, the console", async () => {
    for (const code of [
      `import { forHub } from "../../src/db/forHub.js";`,
      `import { adapters } from "../../src/adapters/index.js";`,
      `import { aiComplete } from "../../src/adapters/ai.js";`,
      `import { sendEmail } from "../../src/services/mailer.js";`,
      `import { installHosting } from "../../src/hosting/index.js";`,
      `import { listHubs } from "../../src/control/hubs.js";`,
      `import type { HubDb } from "../../src/db/forHub.js";`,
      `import { createClient } from "@supabase/supabase-js";`,
      `import x from "../civic.vote/service.js";`,
    ]) {
      expect(await errors("packages/civic.wordcloud/x.ts", code), code).toHaveLength(1);
    }
  });

  it("keeps a manifest plain: src/shared/ and the manifest contract only", async () => {
    expect(await errors("packages/civic.wordcloud/manifest.ts", `import { defineManifest } from "../../src/processes/manifest.js";`)).toHaveLength(0);
    expect(await errors("packages/civic.wordcloud/manifest.ts", `import { emitEvent } from "../../src/sdk/index.js";`)).toHaveLength(1);
    expect(await errors("packages/civic.wordcloud/manifest.ts", `import { Router } from "express";`)).toHaveLength(1);
  });

  it("refuses engine code importing a package, or reading the configured list, outside the files named", async () => {
    expect(await errors("src/services/somethingNew.ts", `import { x } from "../../packages/civic.wordcloud/service.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import { CONFIGURED_PACKAGES } from "../../config/plugins/server.js";`)).toHaveLength(1);
    expect(await errors("src/plugins/loader.ts", `import { CONFIGURED_PACKAGES } from "../../config/plugins/server.js";`)).toHaveLength(0);
  });

  it("names each engine file still reaching into a package, and every one still does (the list only shrinks)", () => {
    for (const [file, why] of Object.entries(PACKAGE_REACH_NOT_YET)) {
      expect(why.length, file).toBeGreaterThan(20);
      expect(readFileSync(resolve(ROOT, file), "utf8"), `${file} no longer reaches a package: take it off the list`).toMatch(
        /from "(\.\.\/)+packages\//,
      );
    }
  });
});
