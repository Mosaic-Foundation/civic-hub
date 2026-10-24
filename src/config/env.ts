// The one place the hub reads its environment (Audit 4, F7; Architecture 5,
// ADR-012).
//
// Every variable is declared in ./settings.ts with its purpose, type, default
// and whether it is required; ./checkSettings.ts validates them at startup.
// Code reads `env.X`. The lint rule `no-restricted-properties`
// (eslint.config.js) refuses `process.env` anywhere else in src/ and api/.
// Scripts and tests read their own environment and are not covered.
//
// Each read happens at access time, not at import: tests and the dev server
// set variables after modules load, and a serverless instance sees the
// deployment's values on every access. A value is trimmed; an empty one reads
// as unset. A declared host name (Vercel's) is read first, then the setting's
// own name, then its older aliases.
//
// Development-only switches are read here but decided in ./devFlags.ts,
// which refuses them in production (Audit 2).

import { SETTINGS, type EngineSettingName, type HostingSettingName, type SettingDecl, type SettingName } from "./settings.js";

function read(name: string): string | undefined {
  // eslint-disable-next-line no-restricted-properties -- the one reader
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** A declared setting's value: its host names, then itself, then its aliases. */
export function readSetting(name: SettingName): string | undefined {
  const decl: SettingDecl = SETTINGS[name];
  for (const n of decl.hostNames ?? []) {
    const v = read(n);
    if (v !== undefined) return v;
  }
  const own = read(name);
  if (own !== undefined) return own;
  for (const n of decl.aliases ?? []) {
    const v = read(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** A variable named at run time: hub-setting fallbacks (ENV_FALLBACKS) only. */
export function envVar(name: string): string | undefined {
  return read(name);
}

/**
 * The whole environment, for functions that take it as an injectable
 * parameter (tests pass their own): `fn(env = processEnv())`.
 */
export function processEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-properties -- the one reader
  return process.env;
}

function reader<K extends SettingName>(names: K[]): { readonly [P in K]: string | undefined } {
  return Object.defineProperties(
    {},
    Object.fromEntries(names.map((name) => [name, { get: () => readSetting(name), enumerable: true }])),
  ) as { readonly [P in K]: string | undefined };
}

const ALL = Object.keys(SETTINGS) as SettingName[];

/** The engine's settings (and the development switches), read at access time. */
export const env = reader(ALL.filter((n) => SETTINGS[n].layer !== "hosting") as EngineSettingName[]);

/**
 * The hosting layer's settings: outside services' keys, the host's own names.
 * Only src/hosting/, src/control/ and api/ may import this (lint:
 * civic/hosting-boundary); the engine asks an adapter instead.
 */
export const hostingEnv = reader(ALL.filter((n) => SETTINGS[n].layer === "hosting") as HostingSettingName[]);

/** NODE_ENV=production: every Vercel deployment. Development flags are refused there. */
export function isProductionEnv(): boolean {
  return env.NODE_ENV === "production";
}
