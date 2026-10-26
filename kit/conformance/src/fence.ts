// What a submitted package may import (ADR-015): the SDK by its npm name
// (`@civic-social/plugin-sdk`, and `/manifest` for its manifest, `/ui` for its
// UI module), its own files, Node's built-ins and the npm packages its
// package.json lists as peer dependencies. Nothing else of the hub. The same
// rule the hub's lint holds its own examples to (civic/package-boundary).
// A check of the import statements, not a parser.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface FenceProblem {
  file: string;
  spec: string;
  why: string;
}

const SDK = new Set(["@civic-social/plugin-sdk", "@civic-social/plugin-sdk/manifest"]);
const UI = new Set(["@civic-social/plugin-sdk/ui", "react", "react-router-dom"]);
const SKIP = new Set(["node_modules", ".git", "dist"]);
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(abs);
    }
  };
  walk(dir);
  return out.sort();
}

function bareName(spec: string): string {
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
}

/** Every import of the package at `dir` that reaches past what a package may. */
export function fenceProblems(dir: string): FenceProblem[] {
  const pj = join(dir, "package.json");
  const peers = existsSync(pj) ? Object.keys((JSON.parse(readFileSync(pj, "utf8")) as { peerDependencies?: Record<string, string> }).peerDependencies ?? {}) : [];
  const out: FenceProblem[] = [];
  for (const file of sources(dir)) {
    const rel = relative(dir, file).split(sep).join("/");
    const isManifest = rel === "manifest.ts";
    const isUi = rel === "ui.tsx";
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]!;
      let why: string | null = null;
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(resolve(dir) + sep)) why = "it reaches outside the package's own files";
      } else if (isManifest) {
        if (spec !== "@civic-social/plugin-sdk/manifest") why = "a manifest is plain data: it imports only @civic-social/plugin-sdk/manifest";
      } else if (!(SDK.has(spec) || (isUi && UI.has(spec)) || spec.startsWith("node:") || peers.includes(bareName(spec)))) {
        why = `the hub is reached only through @civic-social/plugin-sdk; other npm packages must be peerDependencies in package.json`;
      }
      if (why) out.push({ file: rel, spec, why });
    }
  }
  return out;
}
