// civic/package-boundary (eslint.config.js; ADR-014): a plugin package
// reaches the hub only through the SDK, src/shared/, its own files and the
// packages it requires; its manifest only src/shared/ and the manifest
// contract; the engine never imports a package, except the files the list
// names, and that list only shrinks. Linted as planted files of this repo,
// through the repo's config.

import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";


const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/package-boundary").map((m) => m.message);
}

describe("civic/package-boundary", () => {
  it("lets a package on SDK version 0 import it by name, shared data, its own files and node:", async () => {
    for (const code of [
      `import { emitEvent } from "@civic-social/plugin-sdk/first-party";`,
      `import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";`,
      `import { x } from "./service.js";`,
      `import { createHash } from "node:crypto";`,
    ]) {
      // Every package here is on version 1 since Conversations (kernel step 1);
      // a package without the SDK as a peer dependency is still held to version 0.
      expect(await errors("packages/civic.v0_example/x.ts", code), code).toHaveLength(0);
    }
  });

  it("refuses a package reaching the hub around the SDK: the database, an adapter, a service, the hosting layer, the console", async () => {
    for (const code of [
      `import { forHub } from "../../src/db/forHub.js";`,
      `import { adapters } from "../../src/adapters/index.js";`,
      `import { aiComplete } from "../../src/adapters/ai.js";`,
      `import { sendEmail } from "../../src/services/mailer.js";`,
      `import { installHosting } from "../../src/hosting/index.js";`,
      `import { listHubs } from "../../src/operator/hubs.js";`,
      `import type { HubDb } from "../../src/db/forHub.js";`,
      `import { createClient } from "@supabase/supabase-js";`,
      `import x from "../civic.proposals/service.js";`,
    ]) {
      expect(await errors("packages/civic.vote/x.ts", code), code).toHaveLength(1);
    }
  });

  it("refuses the SDK by path now that it has a name (ADR-017)", async () => {
    expect(await errors("packages/civic.vote/x.ts", `import { emitEvent } from "../../src/sdk/index.js";`)).toHaveLength(1);
    expect(await errors("packages/civic.vote/manifest.ts", `import { defineManifest } from "../../src/processes/manifest.js";`)).toHaveLength(1);
  });

  it("keeps a manifest plain: src/shared/ and the manifest contract only", async () => {
    expect(await errors("packages/civic.vote/manifest.ts", `import { defineManifest } from "@civic-social/plugin-sdk/manifest";`)).toHaveLength(0);
    expect(await errors("packages/civic.vote/manifest.ts", `import { emitEvent } from "../../src/sdk/index.js";`)).toHaveLength(1);
    expect(await errors("packages/civic.vote/manifest.ts", `import { Router } from "express";`)).toHaveLength(1);
  });

  it("holds a package on SDK version 1 to the outside rule: the SDK's entries only, and React in its UI files (kernel step 1)", async () => {
    const pkg = "packages/civic.wordcloud";
    for (const code of [
      `import { emitEvent } from "@civic-social/plugin-sdk";`,
      `import { x } from "./service.js";`,
      `import { Router } from "express";`,
    ]) {
      expect(await errors(`${pkg}/x.ts`, code), code).toHaveLength(0);
    }
    for (const code of [
      `import { emitEvent } from "@civic-social/plugin-sdk/first-party";`,
      `import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";`,
      `import { useApi } from "@civic-social/plugin-sdk/ui";`,
      `import { useState } from "react";`,
    ]) {
      expect(await errors(`${pkg}/x.ts`, code), code).toHaveLength(1);
    }
    expect(await errors(`${pkg}/ui/api.ts`, `import { apiRequest } from "@civic-social/plugin-sdk/ui";`)).toHaveLength(0);
    expect(await errors(`${pkg}/ui/api.ts`, `import { request } from "../../../ui/src/services/http";`)).toHaveLength(1);
  });

  it("lets a space type use the kernel and load its packages on first use; the engine reaches it only through config/space.ts (kernel step 3)", async () => {
    const space = "spaces/civic/x.ts";
    expect(await errors(space, `import { forHub } from "../../src/db/forHub.js";`)).toHaveLength(0);
    expect(await errors(space, `import type { VoteProcessState } from "../../packages/civic.vote/service.js";`)).toHaveLength(0);
    expect(await errors(space, `export const f = async () => (await import("../../packages/civic.vote/service.js")).propose;`)).toHaveLength(0);
    expect(await errors(space, `import { propose } from "../../packages/civic.vote/service.js";`)).toHaveLength(1);
    expect(await errors(space, `import { rollup } from "../../features/analytics/rollup.js";`)).toHaveLength(1);
    expect(await errors(space, `import { x } from "../other/x.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import civic from "../../spaces/civic/index.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import { SPACE } from "../../config/space.js";`)).toHaveLength(1);
    expect(await errors("src/plugins/spaceType.ts", `import { SPACE } from "../../config/space.js";`)).toHaveLength(0);
  });

  it("refuses engine code importing a package, or reading the configured list, outside the files named", async () => {
    expect(await errors("src/services/somethingNew.ts", `import { x } from "../../packages/civic.wordcloud/service.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import { CONFIGURED_PACKAGES } from "../../config/plugins/server.js";`)).toHaveLength(1);
    expect(await errors("src/plugins/loader.ts", `import { CONFIGURED_PACKAGES } from "../../config/plugins/server.js";`)).toHaveLength(0);
  });

  it("holds a feature package to the same fence; the engine reaches one only through config/features.ts (ADR-016)", async () => {
    for (const code of [
      `import { readAll } from "../../src/sdk/index.js";`,
      `import { MEASURES } from "../../src/shared/participation.js";`,
      `import { x } from "./plan.js";`,
      `import { createHash } from "node:crypto";`,
      `import { Router } from "express";`,
    ]) {
      expect(await errors("features/analytics/x.ts", code), code).toHaveLength(0);
    }
    for (const code of [
      `import { forHub } from "../../src/db/forHub.js";`,
      `import { listHubs } from "../../src/operator/hubs.js";`,
      `import { castBallot } from "../../src/db/atomic.js";`,
      `import x from "../../packages/civic.vote/service.js";`,
      `import { createClient } from "@supabase/supabase-js";`,
    ]) {
      expect(await errors("features/analytics/x.ts", code), code).toHaveLength(1);
    }
    expect(await errors("features/analytics/manifest.ts", `import { readAll } from "../../src/sdk/index.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import { rollup } from "../../features/analytics/rollup.js";`)).toHaveLength(1);
    expect(await errors("src/services/somethingNew.ts", `import { FEATURE_PACKAGES } from "../../config/features.js";`)).toHaveLength(1);
    expect(await errors("src/plugins/features.ts", `import { FEATURE_PACKAGES } from "../../config/features.js";`)).toHaveLength(0);
  });
});
