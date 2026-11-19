// What mounted packages contribute to the kernel's own routes (kernel step 3):
// the kernel asks the packages that offer something, by what they offer,
// never by name. Each asks only packages that are mounted and whose plugin is
// on for the hub in scope.

import { loadedPackages, type LoadedPackage } from "../plugins/loader.js";
import { isPackageMounted } from "../plugins/mountedState.js";
import { isPluginEnabledSync } from "./hubSettings.js";

function live(): LoadedPackage[] {
  return loadedPackages().filter((p) => isPackageMounted(p.pkg.name) && isPluginEnabledSync(p.plugin));
}

/**
 * The phase a comment on this id is filed under when the id is no process
 * but something a package takes comments on (a proposal), or null.
 */
export async function inputTargetPhase(id: string): Promise<"proposal" | null> {
  for (const p of live()) {
    const t = p.server.inputTargets;
    if (t && (await t.exists(id))) return t.phase;
  }
  return null;
}

/** The development reset: every loaded package empties its own records (mounted or not, on or off). */
export async function resetPackagesForDev(): Promise<void> {
  for (const p of loadedPackages()) await p.server.dev?.reset?.();
}

/**
 * What the package that owns a plugin setting (`plugin.<id>.<name>`) says is
 * wrong with this value, or null (PluginServer.checkSetting, kernel step 3).
 * Asked of the loaded package whether or not it is switched on: an admin may
 * set a plugin up before turning it on.
 */
export function packageSettingProblem(key: string, value: string): string | null {
  const m = /^plugin\.([a-z0-9_]+)\./.exec(key);
  if (!m) return null;
  for (const p of loadedPackages()) {
    if (p.plugin !== m[1] || !p.server.checkSetting) continue;
    const problem = p.server.checkSetting(key, value);
    if (problem) return problem;
  }
  return null;
}
