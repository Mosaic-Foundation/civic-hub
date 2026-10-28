// The plugin SDK's built .js files (ADR-017): what a compiled server runs
// when a package imports `@civic-social/plugin-sdk` by name. They carry no path
// into the engine and hand out the engine's own values, the ones the .ts
// sources (what tsx runs) export. `npm run sdk:build -- --check` keeps them
// current in CI; the compiled-server step proves a real start.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "../../config/plugins/server.js";

const SDK = join(import.meta.dirname, "../../kit/sdk");

describe("the built plugin SDK", () => {
  it("carries no path into the hub's engine", () => {
    for (const f of readdirSync(SDK).filter((f) => f.endsWith(".js"))) {
      const text = readFileSync(join(SDK, f), "utf8");
      expect(text, f).not.toMatch(/from\s+["']\.\.\//);
      expect(text, f).not.toMatch(/import\(\s*["']\.\.\//);
    }
  });

  it.each([
    ["index.js", "index.ts"],
    ["first-party.js", "first-party.ts"],
  ])("%s hands out exactly the engine's values that %s exports", async (built, source) => {
    const fromSource = await import(join(SDK, source));
    const fromBuilt = await import(join(SDK, built));
    expect(Object.keys(fromBuilt).sort()).toEqual(Object.keys(fromSource).sort());
    for (const name of Object.keys(fromSource)) expect(fromBuilt[name], name).toBe(fromSource[name]);
  });

  it("manifest.js is standalone and equal to manifest.ts", async () => {
    const fromSource = await import(join(SDK, "manifest.ts"));
    const fromBuilt = await import(join(SDK, "manifest.js"));
    expect(Object.keys(fromBuilt).sort()).toEqual(Object.keys(fromSource).sort());
    expect(fromBuilt.DEADLINE_CLOSE_INPUT).toEqual(fromSource.DEADLINE_CLOSE_INPUT);
    const d = { type: "x" };
    expect(fromBuilt.defineDescriptor(d)).toBe(d);
    expect(fromBuilt.defineManifest(d)).toBe(d);
    expect(readFileSync(join(SDK, "manifest.js"), "utf8")).not.toContain("engine");
  });

  it("refuses, naming the cause, when no hub installed the engine", () => {
    const text = readFileSync(join(SDK, "engine.js"), "utf8");
    expect(text).toContain("no hub engine installed");
  });

  it("exports point at the built files; tsx keeps the sources", () => {
    const pkg = JSON.parse(readFileSync(join(SDK, "package.json"), "utf8"));
    for (const entry of [".", "./first-party", "./manifest"]) {
      expect(pkg.exports[entry].default).toMatch(/\.js$/);
      expect(pkg.exports[entry].types).toMatch(/\.ts$/);
    }
  });
});
