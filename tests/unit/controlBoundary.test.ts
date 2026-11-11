// civic/control-boundary (eslint.config.js): the hub app may not import the
// super admin. Linted as real files of this repo, through the repo's config.

import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/control-boundary").map((m) => m.message);
}

describe("civic/control-boundary", () => {
  it("refuses src/control/ from the hub app", async () => {
    expect(await boundaryErrors("src/services/x.ts", `import { withConsole } from "../control/index.js";`)).toHaveLength(1);
    expect(await boundaryErrors("src/app.ts", `import { controlRouter } from "./control/router.js";`)).toHaveLength(1);
    expect(await boundaryErrors("src/routes/x.ts", `export * from "../control/hubs.js";`)).toHaveLength(1);
  });

  it("allows the entry points, scripts, tests and src/control/ itself", async () => {
    expect(await boundaryErrors("src/index.ts", `import { withConsole } from "./control/index.js";`)).toHaveLength(0);
    expect(await boundaryErrors("api/index.ts", `import { withConsole } from "../src/control/index.js";`)).toHaveLength(0);
    expect(await boundaryErrors("scripts/x.ts", `import { createHub } from "../src/operator/hubs.js";`)).toHaveLength(0);
    expect(await boundaryErrors("src/control/x.ts", `import { recordAudit } from "./audit.js";`)).toHaveLength(0);
  });

  it("does not flag an unrelated path that merely contains the word", async () => {
    expect(await boundaryErrors("src/services/x.ts", `import { y } from "./controlFlow.js";`)).toHaveLength(0);
  });
});

// civic/console-seam (the console split): the console reaches hubs only
// through the operator API.
async function seamErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/console-seam").map((m) => m.message);
}

describe("civic/console-seam", () => {
  it("refuses the hub's code from the console", async () => {
    expect(await seamErrors("src/control/x.ts", `import { createHub } from "../operator/hubs.js";`)).toHaveLength(1);
    expect(await seamErrors("src/control/x.ts", `import { localOperator } from "../operator/local.js";`)).toHaveLength(1);
    expect(await seamErrors("src/control/x.ts", `import { getHubBySlug } from "../db/hubs.js";`)).toHaveLength(1);
    expect(await seamErrors("src/control/dashboard/x.ts", `import { listHubs } from "../../services/members.js";`)).toHaveLength(1);
  });

  it("allows the console's own files, src/shared/, the operator API's contract and the listed plumbing", async () => {
    expect(await seamErrors("src/control/x.ts", `import { recordAudit } from "./audit.js";`)).toHaveLength(0);
    expect(await seamErrors("src/control/x.ts", `import type { OperatorApi } from "../operator/api.js";`)).toHaveLength(0);
    expect(await seamErrors("src/control/x.ts", `import { PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";`)).toHaveLength(0);
    expect(await seamErrors("src/control/x.ts", `import { env } from "../config/env.js";`)).toHaveLength(0);
  });

  it("does not apply outside the console", async () => {
    expect(await seamErrors("src/operator/x.ts", `import { getHubBySlug } from "../db/hubs.js";`)).toHaveLength(0);
  });
});
