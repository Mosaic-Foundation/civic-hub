// npm run plugins:sync [-- --check]
//
// The hub loads the plugin packages named in config/plugins.json (the hosting
// layer's list; ADR-014). Vercel's bundler and Vite follow only static
// imports, so this writes the list out as three static import files, and
// copies each package's migrations to where the database CLI applies them:
//
//   config/plugins/manifests.ts   each package's manifest (plain data: the
//                                 server and the UI read it);
//   config/plugins/server.ts      each package's server entry and its files (what
//                                 its content hash covers), for the loader;
//   config/plugins/ui.ts          each package's UI module;
//   supabase/migrations/<ts>_pkg_<id>__<name>.sql
//                                 a byte-for-byte copy of each file in a
//                                 package's migrations/, applied in timestamp
//                                 order with the hub's own.
//
// It also checks each package's shape: package.json's name and version equal
// its index.ts's, and the files the contract names are there.
//
// --check changes nothing and exits 1 when any written file would differ or a
// copied migration is missing or stale (CI runs it).

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFiles } from "../src/plugins/hash.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const HEADER = "// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.\n";

interface PackageJson {
  name?: string;
  version?: string;
}

function fail(message: string): never {
  console.error(`plugins:sync: ${message}`);
  process.exit(1);
}

/** The configured list: package directories, relative to civic-hub, in load order. */
export function readConfiguredList(root = ROOT): string[] {
  const file = join(root, "config", "plugins.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { packages?: unknown };
  if (!Array.isArray(parsed.packages) || parsed.packages.some((p) => typeof p !== "string" || !/^packages\/[a-z0-9._-]+$/.test(p))) {
    fail('config/plugins.json must be { "packages": ["packages/<dir>", ...] }');
  }
  const dirs = parsed.packages as string[];
  if (new Set(dirs).size !== dirs.length) fail("config/plugins.json names a package twice");
  return dirs;
}

/** A package's migration file names, sorted, each `<14-digit timestamp>_<name>.sql`. */
function packageMigrations(dir: string): string[] {
  const m = join(ROOT, dir, "migrations");
  if (!existsSync(m)) return [];
  const files = readdirSync(m).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(f)) fail(`${dir}/migrations/${f}: name it <14-digit timestamp>_<words>.sql`);
  }
  return files;
}

/** The copy's name in supabase/migrations/: the package's id keeps two packages' files apart. */
function copiedName(dir: string, file: string): string {
  const id = dir.slice("packages/".length).replace(/[^a-z0-9]/g, "_");
  const [ts, ...rest] = file.split("_");
  return `${ts}_pkg_${id}__${rest.join("_")}`;
}

function main(): void {
  const dirs = readConfiguredList();
  const names: string[] = [];
  for (const dir of dirs) {
    const abs = join(ROOT, dir);
    for (const f of ["package.json", "index.ts", "manifest.ts", "ui.tsx"]) {
      if (!existsSync(join(abs, f))) fail(`${dir}: missing ${f} (docs/PLUGIN-PACKAGE.md)`);
    }
    const pj = JSON.parse(readFileSync(join(abs, "package.json"), "utf8")) as PackageJson;
    const index = readFileSync(join(abs, "index.ts"), "utf8");
    const name = /\bname:\s*"([^"]+)"/.exec(index)?.[1];
    const version = /\bversion:\s*"([^"]+)"/.exec(index)?.[1];
    if (!pj.name || !pj.version) fail(`${dir}/package.json: needs "name" and "version"`);
    if (name !== pj.name || version !== pj.version) {
      fail(`${dir}: index.ts says ${name}@${version}, package.json says ${pj.name}@${pj.version}`);
    }
    names.push(pj.name!);
  }

  const imports = (from: string, file: string, ext: string) =>
    dirs.map((d, i) => `import ${from}${i} from "../../${d}/${file}${ext}";`).join("\n");
  const files: Record<string, string> = {
    "config/plugins/manifests.ts":
      HEADER +
      "// Every configured package's manifest, in load order: plain data the server and the UI both read.\n\n" +
      `${imports("m", "manifest", ".js")}\n\n` +
      `export const PACKAGE_MANIFESTS = [${dirs.map((_, i) => `m${i}`).join(", ")}] as const;\n\n` +
      "/** Each configured package's directory and name, beside its manifest. */\n" +
      "export const PACKAGE_ENTRIES = [\n" +
      dirs.map((d, i) => `  { dir: "${d}", name: "${names[i]}", manifest: m${i} },\n`).join("") +
      "] as const;\n",
    "config/plugins/server.ts":
      HEADER +
      "// Every configured package's server entry, in load order, for src/plugins/loader.ts.\n\n" +
      'import type { ConfiguredPackage } from "../../src/plugins/package.js";\n' +
      `${imports("p", "index", ".js")}\n\n` +
      "export const CONFIGURED_PACKAGES: readonly ConfiguredPackage[] = [\n" +
      dirs.map((d, i) => `  { dir: "${d}", pkg: p${i}, files: ${JSON.stringify(packageFiles(join(ROOT, d)))} },\n`).join("") +
      "];\n",
    "config/plugins/ui.ts":
      HEADER +
      "// Every configured package's UI module, in load order, for ui/src/processes/index.ts.\n\n" +
      'import type { ProcessUi } from "../../ui/src/processes/types";\n' +
      `${imports("u", "ui", "")}\n\n` +
      `export const PACKAGE_UI: readonly ProcessUi[] = [${dirs.map((_, i) => `u${i}`).join(", ")}];\n`,
  };

  const stale: string[] = [];
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(ROOT, rel);
    const now = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (now === body) continue;
    stale.push(rel);
    if (!CHECK) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
  }
  for (const dir of dirs) {
    for (const f of packageMigrations(dir)) {
      const src = readFileSync(join(ROOT, dir, "migrations", f));
      const rel = `supabase/migrations/${copiedName(dir, f)}`;
      const abs = join(ROOT, rel);
      if (existsSync(abs) && readFileSync(abs).equals(src)) continue;
      stale.push(rel);
      if (!CHECK) writeFileSync(abs, src);
    }
  }

  if (CHECK) {
    if (stale.length > 0) fail(`stale, run \`npm run plugins:sync\`: ${stale.join(", ")}`);
    console.log(`plugins:sync: ${dirs.length} packages, everything current`);
  } else {
    console.log(stale.length ? `plugins:sync: wrote ${stale.join(", ")}` : "plugins:sync: nothing to write");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
