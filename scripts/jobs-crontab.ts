// Print the schedule for every job in src/jobs/registry.ts.
//
//   npm run jobs:crontab                       a crontab for a non-Vercel host
//   npm run jobs:crontab -- --base https://x   ... with the base URL filled in
//   npm run jobs:crontab -- --prefix /internal ... for a plain Express server
//                                              (no /api rewrite in front)
//   npm run jobs:crontab -- --vercel           vercel.json's "crons" section
//
// vercel.json is checked against the same list by tests/unit/jobRegistry
// .test.ts, so paste the --vercel output there whenever a job changes.
// Reads no environment and touches no database.

import { crontab, vercelCrons } from "../src/jobs/registry.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (args.includes("--vercel")) {
  process.stdout.write(`${JSON.stringify({ crons: vercelCrons() }, null, 2)}\n`);
} else {
  const prefix = flag("--prefix");
  process.stdout.write(
    crontab({ baseUrl: flag("--base"), prefix: prefix === "" ? "" : prefix }),
  );
}
