// npx tsx kit/scripts/prove.ts [--keep-dir]
//
// The developer path, end to end, as an outside developer meets it (plugin
// session 2, ADR-015): the SDK and the conformance suite packed as npm
// packages (./pack.ts), installed into an empty folder outside this
// repository, and `civic-conformance` run there against
//   - the worked example (examples/straw-poll): it must pass;
//   - the SDK tour (kit/conformance/fixtures/sdk-tour), every SDK v1
//     capability through the SDK alone (steps 11 to 17): it must pass;
//   - a deliberately broken copy of it (kit/conformance/fixtures/broken-poll,
//     which lets a resident answer twice): it must not pass;
//   - a copy whose migration is not additive (kit/conformance/fixtures/
//     not-additive): it must be refused before anything runs.
// Needs the local stack running (the hub's database) and npm's registry for
// x
// CI runs it after the API suite (it leaves the stack as it found it).

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pack } from "./pack.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = mkdtempSync(join(tmpdir(), "civic-plugin-dev-"));
console.log(`prove: an empty folder outside the repository: ${dir}`);

const { sdk, conformance } = pack(join(dir, "tarballs"));
const project = join(dir, "project");
cpSync(join(ROOT, "examples/straw-poll"), join(project, "straw-poll"), { recursive: true });
cpSync(join(ROOT, "kit/conformance/fixtures/broken-poll"), join(project, "broken-poll"), { recursive: true });
cpSync(join(ROOT, "kit/conformance/fixtures/not-additive"), join(project, "not-additive"), { recursive: true });
cpSync(join(ROOT, "kit/conformance/fixtures/sdk-tour"), join(project, "sdk-tour"), { recursive: true });
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "plugin-dev", private: true, type: "module" }, null, 2) + "\n");
const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", sdk, conformance], { cwd: project, stdio: "inherit" });
if (install.status !== 0) {
  console.error("prove: npm install failed (output above)");
  process.exit(1);
}

const run = (pkg: string) =>
  spawnSync(join(project, "node_modules/.bin/civic-conformance"), [`./${pkg}`, "--port", "3410"], { cwd: project, stdio: "inherit", env: { PATH: process.env.PATH, HOME: process.env.HOME } }).status;

const example = run("straw-poll");
const broken = run("broken-poll");
// Every SDK v1 capability through the SDK alone (engine 2, steps 11 to 17).
const tour = run("sdk-tour");
const refusal = spawnSync(join(project, "node_modules/.bin/civic-conformance"), ["./not-additive"], { cwd: project, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
const refused = refusal.status !== 0 && refusal.stderr.includes("it drops something") && !refusal.stdout.includes("applied to the local stack");
console.log(`\nprove: the example ${example === 0 ? "passed, as it must" : `did not pass (exit ${example})`}`);
console.log(`prove: the SDK tour ${tour === 0 ? "passed, as it must" : `did not pass (exit ${tour})`}`);
console.log(`prove: the broken copy ${broken !== 0 ? "did not pass, as it must not" : "PASSED, which it must not"}`);
console.log(`prove: the copy with a migration that is not additive ${refused ? "was refused before anything ran, as it must be" : `was not refused as it must be:\n${refusal.stderr}`}`);
if (!process.argv.includes("--keep-dir")) rmSync(dir, { recursive: true, force: true });
process.exit(example === 0 && tour === 0 && broken !== 0 && refused ? 0 : 1);
