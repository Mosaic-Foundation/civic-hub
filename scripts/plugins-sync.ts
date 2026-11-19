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
//   config/space.ts, config/spaceType.ts, config/spacePalette.ts,
//   config/spacePalette.css      the space type the deployment picks
//                                 (config/plugins.json's "space": "spaces/<dir>",
//                                 or null for none; kernel step 4): its server
//                                 part, its record, its palette and its colours;
//   supabase/migrations/<ts>_pkg_<id>__<name>.sql
//                                 a byte-for-byte copy of each file in a
//                                 package's migrations/, applied in timestamp
//                                 order with the hub's own.
//
// It also checks each package's shape: package.json's name and version equal
// its index.ts's, and the files the contract names are there.
//
// --check changes nothing and exits 1 when any written file would differ or a
// copied migration is missing or stale (CI runs it). --no-migrations leaves
// supabase/migrations/ alone: the conformance test host applies a submitted
// package's migrations to the local stack itself (kit/conformance; ADR-015).

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFiles } from "../src/plugins/hash.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const NO_MIGRATIONS = process.argv.includes("--no-migrations");
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

/** The space type the deployment picks (config/plugins.json's "space"): its directory, or null. */
export function readConfiguredSpace(root = ROOT): string | null {
  const parsed = JSON.parse(readFileSync(join(root, "config", "plugins.json"), "utf8")) as { space?: unknown };
  const space = parsed.space ?? null;
  if (space !== null && (typeof space !== "string" || !/^spaces\/[a-z0-9._-]+$/.test(space))) {
    fail('config/plugins.json\'s "space" must be "spaces/<dir>" or null');
  }
  return space as string | null;
}

/** The files that name the deployment's space type, or say it has none. */
export function spaceFiles(space: string | null): Record<string, string> {
  const head = (what: string) =>
    HEADER + `// The deployment's space type (config/plugins.json's "space"): ${what}\n\n`;
  return {
    "config/space.ts":
      head("its server part. The kernel reads it in one place, src/plugins/spaceType.ts.") +
      'import type { SpaceServer } from "../src/plugins/space.js";\n' +
      (space ? `import space from "../${space}/index.js";\n\nexport const SPACE: SpaceServer | null = space;\n` : "\nexport const SPACE: SpaceServer | null = null;\n"),
    "config/spaceType.ts":
      head("its record (names, mail, profile). Read only by src/shared/spaceTypes.ts.") +
      'import type { SpaceType } from "../src/shared/spaceTypes.js";\n' +
      (space ? `import type_ from "../${space}/type.js";\n\nexport const SPACE_TYPE: SpaceType | null = type_;\n` : "\nexport const SPACE_TYPE: SpaceType | null = null;\n"),
    "config/spacePalette.ts":
      head("its palette. Read only by src/shared/spacePalette.ts. Plain data, because the UI reads it too.") +
      'import type { SpacePalette } from "../src/shared/spacePalette.js";\n' +
      (space ? `import palette from "../${space}/palette.js";\n\nexport const PALETTE: SpacePalette | null = palette;\n` : "\nexport const PALETTE: SpacePalette | null = null;\n"),
    "config/spacePalette.css":
      "/* Written by `npm run plugins:sync` from config/plugins.json. Do not edit.\n" +
      "   The colours of the deployment's space type's palette, loaded right after the\n" +
      "   kernel's theme.css (ui/src/styles/hubStyles.ts). Empty with no space type. */\n" +
      (space ? `@import "../${space}/palette.css";\n` : ""),
  };
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

async function main(): Promise<void> {
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
  const space = readConfiguredSpace();
  if (space) {
    for (const f of ["index.ts", "type.ts", "palette.ts", "palette.css"]) {
      if (!existsSync(join(ROOT, space, f))) fail(`${space}: missing ${f} (a space type's files; docs/KERNEL.md)`);
    }
  }
  const files: Record<string, string> = {
    ...spaceFiles(space),
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
      "// First: the engine the built plugin SDK reads, before any package's module runs (ADR-017).\n" +
      'import "../../src/sdk/install.js";\n' +
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
  for (const dir of NO_MIGRATIONS ? [] : dirs) {
    for (const f of packageMigrations(dir)) {
      const src = readFileSync(join(ROOT, dir, "migrations", f));
      const rel = `supabase/migrations/${copiedName(dir, f)}`;
      const abs = join(ROOT, rel);
      if (existsSync(abs) && readFileSync(abs).equals(src)) continue;
      stale.push(rel);
      if (!CHECK) writeFileSync(abs, src);
    }
  }

  // Files the hub keeps that each type used to join by hand (engine 2, B9),
  // now written from the manifests.
  const manifests = await Promise.all(
    dirs.map(async (d) => ((await import(join(ROOT, d, "manifest.ts"))) as { default: DerivedManifest }).default),
  );
  for (const [rel, body] of derivedFiles(manifests)) {
    const abs = join(ROOT, rel);
    if (readFileSync(abs, "utf8") === body) continue;
    stale.push(rel);
    if (!CHECK) writeFileSync(abs, body);
  }

  if (CHECK) {
    if (stale.length > 0) fail(`stale, run \`npm run plugins:sync\`: ${stale.join(", ")}`);
    console.log(`plugins:sync: ${dirs.length} packages, everything current`);
  } else {
    console.log(stale.length ? `plugins:sync: wrote ${stale.join(", ")}` : "plugins:sync: nothing to write");
  }
}

/** What derivedFiles reads of a manifest. */
interface DerivedManifest {
  descriptor: { plugin: string };
  detailPath(id: string): string;
  pluginSection?: {
    help?: { text: string; page: string; anchor: string; pending?: boolean };
    fields?: ReadonlyArray<{ key: string; help?: { text: string; page: string; anchor: string; pending?: boolean } }>;
  };
}

/**
 * Addresses that keep a share card though no configured type serves them any
 * more: a retired type's published pages, which redirect (vote results to
 * their brief; engine 2, C).
 */
const LEGACY_SHARE_PATHS = ["/vote-results"];

/**
 * The files written from the manifests (B9):
 *   - vercel.json: a crawler's share-card rewrite (/api/og) for each type's
 *     page path, and the legacy ones. The block is rewritten only when the
 *     set of paths changes, keeping its order (new ones go last);
 *   - src/shared/helpRegistry.json: `plugins.<id>` for each manifest that
 *     declares its help note, in place, or after the last plugins.* key; and
 *     each of its settings' notes (`fields[].help`, kernel step 4) under the
 *     setting's key, in place, or after the last plugin.* key.
 */
export function derivedFiles(manifests: readonly DerivedManifest[], root = ROOT): Array<[string, string]> {
  const out: Array<[string, string]> = [];

  // The hosting layer's file: a host without one (the packed test host,
  // run-anywhere) has no share-card rewrites to keep in step.
  const vercelPath = join(root, "vercel.json");
  const vercelText = existsSync(vercelPath) ? readFileSync(vercelPath, "utf8") : '{"rewrites":[]}';
  const vercel = JSON.parse(vercelText) as { rewrites: Array<{ source: string; destination: string; has?: unknown }> };
  const og = vercel.rewrites.filter((r) => r.destination === "/api/og");
  const wanted = new Set([...manifests.map((m) => `/${m.detailPath("x").split("/")[1]}`), ...LEGACY_SHARE_PATHS]);
  const have = og.map((r) => r.source.replace(/\/:id\*$/, ""));
  if (og.length > 0 && (have.length !== wanted.size || have.some((p) => !wanted.has(p)))) {
    const first = vercel.rewrites.indexOf(og[0]);
    const kept = og.filter((r) => wanted.has(r.source.replace(/\/:id\*$/, "")));
    const added = [...wanted].filter((p) => !have.includes(p)).map((p) => ({ source: `${p}/:id*`, destination: "/api/og", has: og[0].has }));
    const rest = vercel.rewrites.filter((r) => r.destination !== "/api/og");
    rest.splice(first, 0, ...kept, ...added);
    out.push(["vercel.json", JSON.stringify({ ...vercel, rewrites: rest }, null, 2) + "\n"]);
  }

  const helpText = readFileSync(join(root, "src/shared/helpRegistry.json"), "utf8");
  const help = JSON.parse(helpText) as Record<string, unknown>;
  let next: Record<string, unknown> = { ...help };
  const put = (key: string, note: { text: string; page: string; anchor: string; pending?: boolean }, prefix: string) => {
    const entry = { text: note.text, page: note.page, anchor: note.anchor, ...(note.pending ? { pending: true } : {}) };
    if (key in next) {
      next[key] = entry;
    } else {
      const keys = Object.keys(next);
      const after = keys.reduce((last, k, i) => (k.startsWith(prefix) ? i : last), keys.length - 1);
      next = Object.fromEntries([...keys.slice(0, after + 1).map((k) => [k, next[k]]), [key, entry], ...keys.slice(after + 1).map((k) => [k, next[k]])]);
    }
  };
  for (const m of manifests) {
    const note = m.pluginSection?.help;
    if (note) put(`plugins.${m.descriptor.plugin}`, note, "plugins.");
    for (const f of m.pluginSection?.fields ?? []) if (f.help) put(f.key, f.help, "plugin.");
  }
  const helpBody = JSON.stringify(next, null, 2) + "\n";
  if (helpBody !== helpText) out.push(["src/shared/helpRegistry.json", helpBody]);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
