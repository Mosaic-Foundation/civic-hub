// Build the plugin SDK's .js files (ADR-017): `npm run sdk:build`, and
// `npm run sdk:build -- --check` in CI (fails when a committed file is stale).
//
// A package imports `@civic-social/plugin-sdk` by name. Compiled, the name
// resolves through kit/sdk/package.json's exports to these files, which carry
// no path into the hub's engine:
//   index.js        version 1: each name read from the engine the hub
//                   installed (engine.js; src/sdk/install.ts)
//   first-party.js  version 0, the same way, for the packages this repository ships
//   manifest.js     the manifest helpers, standalone (a manifest is read before
//                   any package loads, and in the browser)
// Under tsx the .ts sources run instead (tsconfig paths, vitest's alias).
//
// The names are read from the .ts sources at runtime, so a name added there
// and not built here fails the check. They are imported by the SDK's name,
// which tsconfig paths map to the .ts sources (a relative .js path would load
// the built file itself).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "../sdk");
const CHECK = process.argv.includes("--check");

const HEADER = (from: string) =>
  `// Written by \`npm run sdk:build\` from ${from}. Do not edit (ADR-017).\n` +
  "// Each name is the engine's own value, read from what the running hub installed.\n\n" +
  'import { engine } from "./engine.js";\n\nconst e = engine();\n';

function bridged(from: string, names: string[]): string {
  return HEADER(from) + names.map((n) => `export const ${n} = e.${n};\n`).join("");
}

/**
 * The value names a module exports (not its types), read by the TypeScript
 * compiler from the source, without running it: running the engine loads the
 * packages, which import the very file this writes.
 */
function valueExports(file: string): string[] {
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const mod = source && checker.getSymbolAtLocation(source);
  if (!mod) throw new Error(`sdk:build: cannot read the exports of ${file}`);
  const typeOnly = (sym: ts.Symbol) =>
    (sym.declarations ?? []).some(
      (d) => (ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly)) || ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d),
    );
  return checker
    .getExportsOfModule(mod)
    .filter((sym) => {
      if (typeOnly(sym)) return false;
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((sym) => sym.name)
    .sort();
}

async function main(): Promise<void> {
  const v1 = valueExports(join(SDK, "index.ts"));
  const v0 = valueExports(join(SDK, "../../src/sdk/index.ts"));
  const manifest = await import("@civic-social/plugin-sdk/manifest");

  const files: Record<string, string> = {
    // Every name listed, never `export *`: vitest copies a star re-export's
    // names at evaluation, so a package imported while the engine is still
    // loading (a test that imports one directly) read them undefined. A named
    // re-export stays a live binding.
    "first-party.ts":
      readFileSync(join(SDK, "first-party.ts"), "utf8").split("\n// --- Written by")[0].trimEnd() +
      "\n\n// --- Written by `npm run sdk:build` from src/sdk/index.ts. Do not edit below. ---\n" +
      'export type * from "../../src/sdk/index.js";\n' +
      `export {\n${v0.map((n) => `  ${n},`).join("\n")}\n} from "../../src/sdk/index.js";\n`,
    "index.js": bridged("index.ts", v1),
    "first-party.js": bridged("first-party.ts (src/sdk/index.ts)", v0),
    "manifest.js":
      "// Written by `npm run sdk:build` from manifest.ts. Do not edit (ADR-017).\n" +
      "// Standalone: a manifest is read before any package loads, and in the browser.\n\n" +
      "export function defineDescriptor(descriptor) {\n  return descriptor;\n}\n\n" +
      "export function defineManifest(manifest) {\n  return manifest;\n}\n\n" +
      `export const DEADLINE_CLOSE_INPUT = ${JSON.stringify(manifest.DEADLINE_CLOSE_INPUT, null, 2)};\n`,
  };
  const extra = Object.keys(manifest).filter((k) => !["defineDescriptor", "defineManifest", "DEADLINE_CLOSE_INPUT"].includes(k));
  if (extra.length) throw new Error(`sdk:build: manifest.ts exports ${extra.join(", ")}, which manifest.js does not build`);

  const stale: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    const abs = join(SDK, name);
    let current = "";
    try {
      current = readFileSync(abs, "utf8");
    } catch {
      /* missing */
    }
    if (current === body) continue;
    stale.push(name);
    if (!CHECK) writeFileSync(abs, body);
  }
  if (CHECK && stale.length) {
    console.error(`sdk:build: stale ${stale.join(", ")}; run \`npm run sdk:build\` and commit`);
    process.exit(1);
  }
  console.log(stale.length ? `sdk:build: ${CHECK ? "stale" : "wrote"} ${stale.join(", ")}` : "sdk:build: current");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
