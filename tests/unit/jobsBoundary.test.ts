// A job never imports a controller (eslint.config.js, ADR-012): it returns a
// JobOutcome (src/jobs/types.ts), and what it shares with a request handler
// lives in src/services/ or src/jobs/. Linted as real files of this repo.

import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

describe("jobs and controllers", () => {
  it("refuses a controller in a job", async () => {
    expect(await errors("src/jobs/x.ts", `import { handleListBriefs } from "../controllers/briefController.js";`)).toHaveLength(1);
  });

  it("allows a job its services, its siblings and the jobs' types", async () => {
    expect(await errors("src/jobs/x.ts", `import { notifyCronOutcome } from "../services/cronAlerts.js";`)).toHaveLength(0);
    expect(await errors("src/jobs/x.ts", `import { describeJobRun } from "./describe.js";`)).toHaveLength(0);
  });
});
