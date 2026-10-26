#!/usr/bin/env node
// The `civic-conformance` command: runs ../cli.ts (TypeScript) through tsx.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
const r = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
