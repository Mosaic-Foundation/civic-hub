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

async function main(): Promise<void> {
  // The engine as the hub loads it (its packages import the SDK while it is
  // still being evaluated, so it is entered where the hub enters it).
  await import("../../config/plugins/server.js");
  const v1 = Object.keys(await import("@civic-social/plugin-sdk")).sort();
  const v0 = Object.keys(await import("@civic-social/plugin-sdk/first-party")).sort();
  const manifest = await import("@civic-social/plugin-sdk/manifest");

  const files: Record<string, string> = {
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
