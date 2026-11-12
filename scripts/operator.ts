// npm run operator -- <command>     (npm run operator -- help for the list)
//
// The operator command for a self-hosted hub deployment: what Civic.Social's
// console does for its hubs (make, change, archive, export; approve and sign
// plugin catalog entries with your own key), through the hub's operator API.
// See scripts/lib/operatorCli.ts and docs in HANDOFF.md (2026-11-12).

import { createInterface } from "node:readline/promises";
import { runOperatorCli } from "./lib/operatorCli.js";

const argv = process.argv.slice(2);

// --env-file <path>: read settings from a file (Node's own parser), before anything reads them.
const at = argv.indexOf("--env-file");
if (at >= 0 && argv[at + 1]) {
  try {
    process.loadEnvFile(argv[at + 1]);
  } catch (err) {
    console.error(`Could not read ${argv[at + 1]}: ${(err as Error).message}`);
    process.exit(2);
  }
}

const code = await runOperatorCli(argv, {
  env: process.env,
  io: {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    async confirm(question) {
      if (!process.stdin.isTTY) {
        console.error(`${question} (not a terminal: add --yes to answer yes)`);
        return false;
      }
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
      } finally {
        rl.close();
      }
    },
  },
});
process.exit(code);
