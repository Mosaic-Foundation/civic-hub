// civic/hosting-boundary (eslint.config.js, ADR-012): the engine may not
// import the hosting layer, its settings (hostingEnv) or a vendor's package.
// Linted as real files of this repo, through the repo's config.

import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "civic/hosting-boundary").map((m) => m.message);
}

describe("civic/hosting-boundary", () => {
  it("refuses the hosting layer from the engine and the plugins", async () => {
    expect(await errors("src/modules/civic.vote/x.ts", `import { anthropicProvider } from "../../hosting/anthropic.js";`)).toHaveLength(1);
    expect(await errors("src/processes/x.ts", `import { installHosting } from "../hosting/index.js";`)).toHaveLength(1);
    expect(await errors("src/authz/x.ts", `export * from "../hosting/resend.js";`)).toHaveLength(1);
    expect(await errors("src/services/x.ts", `const m = await import("../hosting/youtube.js");`)).toHaveLength(1);
    expect(await errors("src/shared/polis_deliberation/x.ts", `import { polisService } from "../../hosting/polis.js";`)).toHaveLength(1);
  });

  it("refuses the hosting settings from the engine", async () => {
    expect(await errors("src/services/x.ts", `import { env, hostingEnv } from "../config/env.js";`)).toHaveLength(1);
    expect(await errors("src/services/x.ts", `import { env } from "../config/env.js";`)).toHaveLength(0);
  });

  it("refuses a vendor's package in the engine", async () => {
    expect(await errors("src/services/x.ts", `import { YoutubeTranscript } from "youtube-transcript";`)).toHaveLength(1);
    expect(await errors("src/modules/civic.assistant/x.ts", `import Anthropic from "@anthropic-ai/sdk";`)).toHaveLength(1);
  });

  it("allows the hosting layer, the console, the composition roots, scripts and tests", async () => {
    const code = `import { installHosting } from "./hosting/index.js";\nimport { hostingEnv } from "./config/env.js";`;
    expect(await errors("src/app.ts", code)).toHaveLength(0);
    expect(await errors("src/index.ts", code)).toHaveLength(0);
    expect(await errors("src/hosting/x.ts", `import { hostingEnv } from "../config/env.js";`)).toHaveLength(0);
    expect(await errors("src/control/x.ts", `import { supabaseObjectReader } from "../hosting/supabaseStorage.js";`)).toHaveLength(0);
    expect(await errors("api/x.ts", `import { hostingEnv } from "../src/config/env.js";`)).toHaveLength(0);
    expect(await errors("scripts/x.ts", `import { installHosting } from "../src/hosting/index.js";`)).toHaveLength(0);
  });

  it("does not flag a path that merely contains the word", async () => {
    expect(await errors("src/services/x.ts", `import { y } from "./hostingNotes.js";`)).toHaveLength(0);
  });
});
