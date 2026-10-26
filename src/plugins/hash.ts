// A plugin package's content hash (ADR-014): what the catalog's approval is
// of. `npm run catalog:add` records it when the conformance suite passes; the
// loader computes it again from the files at startup and mounts the package
// only when an approved catalog row records the same one. Any change to any
// file of the package (code, UI module, migrations, package.json) changes it.
//
// sha256 over the package's files, in sorted path order, each as
// `<path relative to the package>\0<bytes>\0`. node_modules and editor
// droppings are not the package. The loader hashes exactly the files
// `npm run plugins:sync` listed for the package (config/plugins/server.ts):
// a host may put files of its own beside them (Vercel ships its compiled
// .js next to the .ts it was given), and those are not the package either.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP = new Set(["node_modules", ".DS_Store"]);

/** Every file of the package, relative to its directory, sorted, with "/" separators. */
export function packageFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(relative(dir, abs).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * "sha256:<hex>" of the package at `dir` (absolute): of `files` when given
 * (relative paths; a missing one throws), else of every file there.
 */
export function hashPackage(dir: string, files?: readonly string[]): string {
  const h = createHash("sha256");
  for (const file of files ? [...files].sort() : packageFiles(dir)) {
    h.update(file);
    h.update("\0");
    h.update(readFileSync(join(dir, file)));
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}
