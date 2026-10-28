// npx tsx kit/scripts/pack.ts <out dir>
//
// Builds the two npm packages of the developer path (plugin session 2,
// ADR-015) as `npm pack` tarballs in <out dir>, without publishing them:
//
//   @civic-social/plugin-sdk          kit/sdk, with the hub's engine copied
//                                     beside it as host/ (src, config, packages, features,
//                                     supabase, the scripts the test host runs,
//                                     ui/src for the UI module's types), its
//                                     imports pointed there;
//   @civic-social/plugin-conformance  kit/conformance.
//
// The engine travels as TypeScript and runs through tsx, as the hub does
// locally. The jurisdiction list (config/jurisdictions, 38 MB) stays behind:
// the test host never reads it. Publishing is a separate, deliberate step.
//
// Both packages' dependencies are pinned to the versions the hub's lockfile
// installs: a range would let a fresh install take a release the engine was
// never run against (youtube-transcript 1.3.1 moved the file the engine
// imports, and the proof failed in CI only).

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function pack(out: string): { sdk: string; conformance: string } {
  mkdirSync(out, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), "civic-kit-"));
  const hubPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const pinned = (deps: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(deps).map(([name, range]) => [name, lock.packages[`node_modules/${name}`]?.version ?? range]));

  // The SDK, its imports pointed at host/.
  const sdk = join(stage, "sdk");
  const host = join(sdk, "host");
  mkdirSync(host, { recursive: true });
  // The built .js (ADR-017) carry no engine path; they go as they are.
  for (const f of readdirSync(join(ROOT, "kit/sdk")).filter((f) => f.endsWith(".js") && f !== "first-party.js")) {
    cpSync(join(ROOT, "kit/sdk", f), join(sdk, f));
  }
  // first-party is this repository's own (ADR-017): never packed.
  for (const f of readdirSync(join(ROOT, "kit/sdk")).filter((f) => f.endsWith(".ts") && f !== "first-party.ts")) {
    let text = readFileSync(join(ROOT, "kit/sdk", f), "utf8").replaceAll('from "../../', 'from "./host/');
    if (f === "host.ts") text = text.replace('"../.."', '"host"');
    writeFileSync(join(sdk, f), text);
  }
  const skip = (src: string) => !/[/\\](node_modules|\.git|\.temp|\.branches|jurisdictions)([/\\]|$)/.test(src);
  for (const d of ["src", "config", "packages", "features", "supabase", "ui/src"]) cpSync(join(ROOT, d), join(host, d), { recursive: true, filter: skip });
  mkdirSync(join(host, "scripts"), { recursive: true });
  cpSync(join(ROOT, "scripts/plugins-sync.ts"), join(host, "scripts/plugins-sync.ts"));
  for (const f of ["tsconfig.json", "LICENSE", "LICENSING.md"]) cpSync(join(ROOT, f), join(host, f));
  writeFileSync(join(host, "package.json"), JSON.stringify({ name: "civic-hub-test-host", private: true, type: "module" }, null, 2) + "\n");
  const sdkPkg = JSON.parse(readFileSync(join(ROOT, "kit/sdk/package.json"), "utf8"));
  delete sdkPkg.exports["./first-party"];
  sdkPkg.dependencies = pinned({ ...hubPkg.dependencies, pg: hubPkg.devDependencies.pg, tsx: hubPkg.devDependencies.tsx });
  writeFileSync(join(sdk, "package.json"), JSON.stringify(sdkPkg, null, 2) + "\n");
  cpSync(join(ROOT, "LICENSE"), join(sdk, "LICENSE"));
  if (readdirSync(join(ROOT, "kit/sdk")).includes("README.md")) cpSync(join(ROOT, "kit/sdk/README.md"), join(sdk, "README.md"));

  // The suite.
  const conf = join(stage, "conformance");
  for (const f of ["bin", "src", "cli.ts", "vitest.config.ts", "README.md"]) cpSync(join(ROOT, "kit/conformance", f), join(conf, f), { recursive: true });
  const confPkg = JSON.parse(readFileSync(join(ROOT, "kit/conformance/package.json"), "utf8"));
  confPkg.dependencies = { ...pinned(confPkg.dependencies), "@civic-social/plugin-sdk": confPkg.dependencies["@civic-social/plugin-sdk"] };
  writeFileSync(join(conf, "package.json"), JSON.stringify(confPkg, null, 2) + "\n");
  cpSync(join(ROOT, "LICENSE"), join(conf, "LICENSE"));

  const tarball = (dir: string) =>
    join(out, execFileSync("npm", ["pack", "--silent", "--pack-destination", out], { cwd: dir, encoding: "utf8" }).trim().split("\n").pop()!);
  return { sdk: tarball(sdk), conformance: tarball(conf) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: npx tsx kit/scripts/pack.ts <out dir>");
    process.exit(2);
  }
  const made = pack(resolve(out));
  console.log(`kit: ${made.sdk}\nkit: ${made.conformance}`);
}
