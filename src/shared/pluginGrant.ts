// A plugin package's capability grant (plugin architecture spec §4.1;
// plugin session 1, ADR-014): what its code may touch, declared in its
// manifest, recorded in the console's catalog when the operator approves it,
// recorded again per hub when an admin installs it, and enforced at the
// hub's seams (src/plugins/grant.ts):
//
//   activities.emit  the event types it may emit about its own processes,
//                    beyond the hub's own lifecycle events (HOST_EVENT_TYPES),
//                    which the hub emits for every type. Equal to its
//                    descriptor's `emits`. Checked at the one emission path.
//   state.tables     the tables it keeps, beyond `processes`. Equal to its
//                    manifest's tables, legacy ones included. Its store gets a database handle that
//                    refuses every other table.
//   adapters         the outside services it may call, by adapter name. Its
//                    host context carries only these.
//   network.egress   hostnames it may call directly: empty for every package,
//                    because an outside call goes through an adapter.
//   identity.claims  what it is told about a participant: "participant-ref",
//                    the account reference and nothing else.
//   ui.surfaces      where its UI module draws.
//
// No wildcards anywhere. Plain data, shared with the UI: the Install
// confirmation shows grantInPlainWords().

import { ADAPTER_PLAIN, eventPlain } from "./pluginGrantWords.js";

/** The adapters a package may be granted. `errors` and `heartbeat` are the hub's own and are never granted. */
export const GRANTABLE_ADAPTERS = ["ai", "mail", "video", "deliberation", "objectStore", "web"] as const;
export type GrantableAdapter = (typeof GRANTABLE_ADAPTERS)[number];

/** The identity claims a package may be granted, least sensitive first (§4.1). */
export const IDENTITY_CLAIMS = ["participant-ref"] as const;
export type IdentityClaim = (typeof IDENTITY_CLAIMS)[number];

/** Where a package's UI module may draw. */
export const UI_SURFACES = ["process-page", "create-page", "feed-card", "nav-section", "settings-panel"] as const;
export type UiSurface = (typeof UI_SURFACES)[number];

export interface PluginCapabilities {
  activities: { emit: readonly string[]; listen: readonly string[] };
  state: { read: readonly ["own-process"]; write: readonly ["own-process"]; tables: readonly string[] };
  adapters: readonly GrantableAdapter[];
  network: { egress: readonly string[] };
  identity: { claims: readonly IdentityClaim[] };
  ui: { surfaces: readonly UiSurface[] };
}

/** What a package's grant is checked against: its own manifest's declarations. */
export interface GrantOwnFacts {
  emits: readonly string[];
  /** Every table its manifest declares, legacy ones included (their rows are still read). */
  tables: readonly string[];
  /** Its trust tier: a Tier 3 type reaches its outside service through a granted adapter. */
  tier: number;
}

/**
 * Why a declared grant is malformed, or null. Pure: the startup check and the
 * catalog both call it.
 */
export function grantProblem(caps: unknown, own: GrantOwnFacts): string | null {
  if (!caps || typeof caps !== "object") return "has no capabilities (the §4.1 grant)";
  const c = caps as Partial<PluginCapabilities>;
  const list = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "" && !x.includes("*"));
  if (!c.activities || !list(c.activities.emit) || !list(c.activities.listen)) return "capabilities.activities needs emit and listen lists (no wildcards)";
  if (c.activities.listen.length > 0) return "capabilities.activities.listen must be empty: the hub delivers no events to plugins yet";
  if (!c.state || !list(c.state.tables)) return "capabilities.state.tables must list its tables";
  if (JSON.stringify(c.state.read) !== '["own-process"]' || JSON.stringify(c.state.write) !== '["own-process"]') {
    return 'capabilities.state.read and write must be ["own-process"]';
  }
  if (!Array.isArray(c.adapters) || !list(c.adapters) || c.adapters.some((a) => !(GRANTABLE_ADAPTERS as readonly string[]).includes(a))) {
    return `capabilities.adapters may name only ${GRANTABLE_ADAPTERS.join(", ")}`;
  }
  if (!c.network || !Array.isArray(c.network.egress)) return "capabilities.network.egress must be a list";
  if (c.network.egress.length > 0) return "capabilities.network.egress must be empty: a plugin reaches an outside service only through an adapter";
  if (!c.identity || !list(c.identity.claims) || c.identity.claims.some((x) => !(IDENTITY_CLAIMS as readonly string[]).includes(x))) {
    return `capabilities.identity.claims may name only ${IDENTITY_CLAIMS.join(", ")}`;
  }
  if (!c.ui || !list(c.ui.surfaces) || c.ui.surfaces.some((s) => !(UI_SURFACES as readonly string[]).includes(s))) {
    return `capabilities.ui.surfaces may name only ${UI_SURFACES.join(", ")}`;
  }
  const sameSet = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!sameSet(c.activities.emit, own.emits)) return "capabilities.activities.emit must equal its descriptor's emits";
  if (!sameSet(c.state.tables, own.tables)) return "capabilities.state.tables must equal its manifest's tables";
  if (own.tier === 3 && !c.adapters.some((a: GrantableAdapter) => ADAPTER_PLAIN[a].outside)) {
    return "a Tier 3 type reaches its outside service through an adapter, which capabilities.adapters does not name";
  }
  return null;
}

/**
 * What `asked` wants beyond `granted`, one line per reach, or [] when it asks
 * for nothing more. The loader refuses a package whose manifest asks for more
 * than its approved catalog row recorded.
 */
export function beyondGrant(asked: PluginCapabilities, granted: PluginCapabilities): string[] {
  const out: string[] = [];
  const extra = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));
  for (const e of extra(asked.activities.emit, granted.activities.emit)) out.push(`event ${e}`);
  for (const e of extra(asked.activities.listen, granted.activities.listen)) out.push(`listens to ${e}`);
  for (const t of extra(asked.state.tables, granted.state.tables)) out.push(`table ${t}`);
  for (const a of extra(asked.adapters, granted.adapters)) out.push(`adapter ${a}`);
  for (const h of extra(asked.network.egress, granted.network.egress)) out.push(`host ${h}`);
  for (const c of extra(asked.identity.claims, granted.identity.claims)) out.push(`identity claim ${c}`);
  for (const s of extra(asked.ui.surfaces, granted.ui.surfaces)) out.push(`UI surface ${s}`);
  return out;
}

export interface PlainGrantInput {
  /** What the hub calls the plugin: "Votes". */
  name: string;
  caps: PluginCapabilities;
  /** Each of its tables, in plain words: what it holds ("residents' one-word answers"). */
  holds: Readonly<Record<string, string>>;
}

/**
 * The grant as a town clerk reads it, for the Install confirmation: what the
 * plugin will be able to do on this hub, and the things it will not.
 */
export function grantInPlainWords(input: PlainGrantInput): { can: string[]; cannot: string[] } {
  const { caps } = input;
  const can: string[] = [];
  const kept = caps.state.tables.map((t) => input.holds[t] ?? t);
  can.push(
    kept.length > 0
      ? `Keep its own records on this hub: ${kept.join("; ")}. It cannot read or change anything else the hub keeps.`
      : "Store its items with the hub's own records, and nothing else of its own. It cannot read or change anything else the hub keeps.",
  );
  const events = caps.activities.emit.map(eventPlain);
  can.push(
    events.length > 0
      ? `Add entries to the hub's public record about its own items: when ${joinWords(unique(events))}.`
      : "Appear in the hub's public record only through the hub's own entries (created, edited, removed).",
  );
  for (const a of caps.adapters) can.push(ADAPTER_PLAIN[a].can);
  can.push("Know who takes part only by a reference number. The hub, not the plugin, decides when a participant's name is shown.");

  const cannot: string[] = [];
  for (const a of GRANTABLE_ADAPTERS) {
    if (!caps.adapters.includes(a) && ADAPTER_PLAIN[a].cannot) cannot.push(ADAPTER_PLAIN[a].cannot!);
  }
  if (caps.network.egress.length === 0 && !caps.adapters.some((a) => ADAPTER_PLAIN[a].outside)) {
    cannot.push("Contact any service outside this hub.");
  }
  cannot.push("See residents' email addresses.");
  return { can, cannot };
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function joinWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
