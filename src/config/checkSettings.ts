// The startup check of every declared setting (./settings.ts, ADR-012).
//
// Called once when the app module loads (src/app.ts), so `npm run dev`, a
// plain `node src/index.ts` and the Vercel function all check the same way.
// A missing required setting stops the server with a message that names the
// setting and never its value; so does a database setting (required always)
// whose value is not its type, since nothing works without it. Any other
// setting of the wrong type, and a set variable that looks like ours
// (KNOWN_PREFIXES) but that nothing declares, are reported, not refused: a
// value nobody has checked must not take every hub offline, and the code
// already reads what it cannot use as it always has.

import { ENV_FALLBACKS } from "../models/hubSettings.js";
import { processEnv } from "./env.js";
import { KNOWN_PREFIXES, SETTINGS, type SettingDecl, type SettingName, type SettingType } from "./settings.js";

export interface SettingsReport {
  /** Required and unset, each with why it is required. */
  missing: Array<{ name: string; reason: string }>;
  /** Set but not its declared type: refused when required always, reported otherwise. */
  invalid: Array<{ name: string; problem: string; required: boolean }>;
  /** Set, carrying one of our prefixes, and declared nowhere. */
  unknown: string[];
}

const TRUE = new Set(["1", "true", "on", "yes"]);
const BOOLEAN = new Set([...TRUE, "0", "false", "off", "no"]);

function valueOf(environment: NodeJS.ProcessEnv, name: string, decl: SettingDecl): string | undefined {
  for (const n of [...(decl.hostNames ?? []), name, ...(decl.aliases ?? [])]) {
    const v = environment[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Why a value is not its type, or null. Never quotes the value. */
export function typeProblem(type: SettingType, v: string): string | null {
  switch (type) {
    case "url":
      return isUrl(v) ? null : "is not an http(s) URL";
    case "urls":
      return v.split(",").map((x) => x.trim()).filter(Boolean).every(isUrl) ? null : "is not a comma-separated list of http(s) URLs";
    case "integer":
      return /^\d+$/.test(v) ? null : "is not a whole number";
    case "number":
      return Number.isFinite(Number(v)) ? null : "is not a number";
    case "boolean":
      return BOOLEAN.has(v.toLowerCase()) ? null : "is not one of true/false, on/off, yes/no, 1/0";
    case "email":
      return /^[^@\s]+@[^@\s]+$/.test(v) ? null : "is not an email address";
    default:
      return null;
  }
}

/** Every name that is ours: declared settings, their aliases and host names, hub-setting fallbacks. */
export function knownNames(): Set<string> {
  const names = new Set<string>();
  for (const [name, decl] of Object.entries(SETTINGS) as Array<[string, SettingDecl]>) {
    names.add(name);
    for (const n of decl.aliases ?? []) names.add(n);
    for (const n of decl.hostNames ?? []) names.add(n);
  }
  for (const list of Object.values(ENV_FALLBACKS)) for (const n of list) names.add(n);
  return names;
}

/** A wrong type refuses the start only for the settings nothing works without (the database's). */
function isRequired(req: SettingDecl["required"]): boolean {
  return req === "always";
}

export function checkSettings(environment: NodeJS.ProcessEnv = processEnv()): SettingsReport {
  const production = environment.NODE_ENV?.trim() === "production";
  const report: SettingsReport = { missing: [], invalid: [], unknown: [] };

  for (const name of Object.keys(SETTINGS) as SettingName[]) {
    const decl: SettingDecl = SETTINGS[name];
    const v = valueOf(environment, name, decl);
    const req = decl.required;
    if (v === undefined) {
      if (req === "always") report.missing.push({ name, reason: "always required" });
      else if (req === "production" && production) report.missing.push({ name, reason: "required in production" });
      else if (typeof req === "object" && (!req.production || production)) {
        const on = valueOf(environment, req.when, SETTINGS[req.when as SettingName] ?? { purpose: "", type: "string", layer: "engine" });
        if (on !== undefined && TRUE.has(on.toLowerCase())) report.missing.push({ name, reason: `required when ${req.when} is on` });
        else if (on !== undefined && SETTINGS[req.when as SettingName]?.type !== "boolean") {
          report.missing.push({ name, reason: `required when ${req.when} is set` });
        }
      }
      continue;
    }
    const problem = typeProblem(decl.type, v);
    if (problem) report.invalid.push({ name, problem, required: isRequired(req) });
  }

  const known = knownNames();
  for (const [name, value] of Object.entries(environment)) {
    if (!value?.trim() || known.has(name)) continue;
    if (KNOWN_PREFIXES.some((p) => name.startsWith(p))) report.unknown.push(name);
  }
  report.unknown.sort();
  return report;
}

/** The message a refused start prints: names only. */
export function settingsFailure(report: SettingsReport): string | null {
  const lines = [
    ...report.missing.map((m) => `  ${m.name} is not set (${m.reason})`),
    ...report.invalid.filter((i) => i.required).map((i) => `  ${i.name} ${i.problem}`),
  ];
  if (lines.length === 0) return null;
  return `The hub cannot start; fix these settings (RUNBOOK-operations.md → Settings):\n${lines.join("\n")}`;
}

/** Check at startup: throw on missing or invalid, report unknown once. */
export function assertSettings(environment: NodeJS.ProcessEnv = processEnv()): void {
  const report = checkSettings(environment);
  if (report.unknown.length > 0) {
    console.warn(`[settings] set but not a setting this hub reads: ${report.unknown.join(", ")}`);
  }
  for (const i of report.invalid.filter((x) => !x.required)) {
    console.warn(`[settings] ${i.name} ${i.problem}; it is read as unset where the code cannot use it`);
  }
  const failure = settingsFailure(report);
  if (failure) throw new Error(failure);
}
