// civic/db-convention (eslint.config.js, ADR-012): a module uses its store,
// only processService queries `processes`, a controller does not query.
// Linted as real files of this repo, through the repo's config. The rule has
// no exemptions: every module, controller and caller is on the convention.

import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/db-convention").map((m) => m.message);
}

describe("civic/db-convention", () => {
  it("refuses the database layer in a module on the convention", async () => {
    expect(await errors("src/modules/civic.wordcloud/x.ts", `import { forHub } from "../../db/forHub.js";`)).toHaveLength(1);
    expect(await errors("src/modules/civic.vote/x.ts", `import { readAll } from "../../db/readAll.js";`)).toHaveLength(1);
    expect(await errors("src/shared/polis_deliberation/x.ts", `import { forHub } from "../../db/forHub.js";`)).toHaveLength(1);
  });

  it("lets a module import types and error classes from it", async () => {
    expect(await errors("src/modules/civic.wordcloud/x.ts", `import type { HubDb } from "../../db/forHub.js";`)).toHaveLength(0);
    expect(await errors("src/modules/civic.vote/x.ts", `import { AlreadyVotedError } from "../../db/atomic.js";`)).toHaveLength(0);
  });

  it("refuses a query on the processes table outside processService", async () => {
    const code = `export const q = (db: any) => db.from("processes").select("id");`;
    expect(await errors("src/services/somethingNew.ts", code)).toHaveLength(1);
    expect(await errors("src/modules/civic.wordcloud/x.ts", code)).toHaveLength(1);
    expect(await errors("src/services/processRows.ts", code)).toHaveLength(0);
    expect(await errors("src/services/processService.ts", code)).toHaveLength(0);
    expect(await errors("src/services/somethingNew.ts", `export const q = (db: any) => db.from("process_links").select("id");`)).toHaveLength(0);
  });

  it("refuses a query in a controller on the convention", async () => {
    expect(await errors("src/controllers/wordcloudController.ts", `import { forHub } from "../db/forHub.js";`)).toHaveLength(1);
    expect(await errors("src/controllers/newController.ts", `import { readAll } from "../db/readAll.js";`)).toHaveLength(1);
    expect(await errors("src/controllers/newController.ts", `import { HubDbError } from "../db/forHub.js";`)).toHaveLength(0);
    expect(await errors("src/controllers/briefController.ts", `import { readAll } from "../db/readAll.js";`)).toHaveLength(1);
  });

  it("covers every module, the review and auth modules included", async () => {
    expect(await errors("src/modules/civic.review/x.ts", `import { forHub } from "../../db/forHub.js";`)).toHaveLength(1);
    expect(await errors("src/modules/civic.auth/x.ts", `import { takeRateLimit } from "../../db/rateLimit.js";`)).toHaveLength(1);
    expect(await errors("src/modules/civic.receipts/x.ts", `export const q = (db: any) => db.from("processes").select("id");`)).toHaveLength(1);
  });
});
