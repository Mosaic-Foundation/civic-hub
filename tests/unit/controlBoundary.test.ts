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
    expect(await boundaryErrors("scripts/x.ts", `import { createHub } from "../src/control/hubs.js";`)).toHaveLength(0);
    expect(await boundaryErrors("src/control/x.ts", `import { recordAudit } from "./audit.js";`)).toHaveLength(0);
  });

  it("does not flag an unrelated path that merely contains the word", async () => {
    expect(await boundaryErrors("src/services/x.ts", `import { y } from "./controlFlow.js";`)).toHaveLength(0);
  });
});
