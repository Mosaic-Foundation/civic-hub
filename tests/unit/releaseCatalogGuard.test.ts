// The release's catalog guard (engine 2, E15): production runs only code
// whose every package is approved there, and a deployment mounting fewer
// packages than the code lists is a failure (Oct 27: three minutes with no
// plugins, after a "y" was trusted and 0 mounted read as "ok").

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unapproved, wantedPackages } from "../../scripts/catalog-unapproved.js";

const ROOT = join(import.meta.dirname, "../..");

describe("which packages are not approved", () => {
  const wanted = [
    { name: "@x/a", version: "0.2.0" },
    { name: "@x/b", version: "0.1.0" },
    { name: "@x/c", version: "1.0.0" },
  ];
  it("names each pending, withdrawn or missing version, and none approved", () => {
    const rows = [
      { package: "@x/a", version: "0.1.0", status: "approved" },
      { package: "@x/a", version: "0.2.0", status: "pending" },
      { package: "@x/b", version: "0.1.0", status: "approved" },
      { package: "@x/c", version: "1.0.0", status: "withdrawn" },
    ];
    expect(unapproved(wanted, rows)).toEqual([
      { name: "@x/a", version: "0.2.0", status: "pending" },
      { name: "@x/c", version: "1.0.0", status: "withdrawn" },
    ]);
    expect(unapproved(wanted.slice(1, 2), rows)).toEqual([]);
    expect(unapproved([{ name: "@x/d", version: "0.1.0" }], rows)).toEqual([{ name: "@x/d", version: "0.1.0", status: "missing" }]);
  });

  it("reads the configured list with each package's own version", () => {
    const list = wantedPackages(ROOT);
    expect(list.length).toBe((JSON.parse(readFileSync(join(ROOT, "config/plugins.json"), "utf8")) as { packages: string[] }).packages.length);
    expect(list.every((w) => /^@civic-social\//.test(w.name) && /^\d+\.\d+\.\d+$/.test(w.version))).toBe(true);
  });
});

describe("release.sh", () => {
  const script = readFileSync(join(ROOT, "scripts/release.sh"), "utf8");
  it("checks production's catalog before the push, and after the approval question, rather than trusting the answer", () => {
    expect(script).toMatch(/catalog_unapproved\(\)/);
    expect(script).toMatch(/Approve them in the console \(Plugins\)\. Check again\?/);
  });
  it("stops on production when fewer packages are mounted than the code lists", () => {
    expect(script).toMatch(/Production mounts \$MOUNTED_N of \$WANT_N plugin packages/);
  });
});
