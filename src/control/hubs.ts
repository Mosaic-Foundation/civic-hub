// @civic-raw-client-importer: the super admin reads and writes the hubs registry and every hub's settings rows, across hubs.
// The super admin's hub operations: list, create, edit, plugins, admins,
// archive. Every write here is recorded in the audit log by the caller
// (./router.ts) with the before and after this module returns.
//
// createHub() is THE way a hub is created: the console's Create hub screen
// and scripts/create-hub.ts both call it. What differs between them is policy
// the caller passes in (which modes it may create), not the steps.

import { getDb } from "../db/client.js";
import { invalidateHubCache } from "../db/hubs.js";
import { invalidateHubSettings } from "../db/hubSettingsStore.js";
import {
  ADMIN_SETTABLE_HUB_MODES,
  RESERVED_HUB_SLUGS,
  hubSlugRejectionReason,
  isHubMode,
  type Hub,
  type HubMode,
} from "../models/hub.js";
import {
  ENV_FALLBACKS,
  KEYS,
  PLUGIN_IDS,
  asBoolean,
  asEmailList,
  encodeList,
  isPluginId,
  type PluginId,
} from "../models/hubSettings.js";
import { consoleHostname, isProductionDatabase, platformDomain } from "./config.js";
import { defaultGoverningBody, isJurisdictionType, type JurisdictionType } from "../shared/jurisdictionType.js";
import { getJurisdiction } from "./jurisdictions.js";

export class ControlInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ControlInputError";
  }
}

const HUB_COLUMNS =
  "id, protocol_hub_id, hostname, name, jurisdiction_code, jurisdiction_name, jurisdiction_ocd_id, jurisdiction_custom, space_did, space_type, status, mode, created_at, updated_at, archived_at, redirect_to";

export type ControlHub = Hub & {
  archived_at: string | null;
  redirect_to: string | null;
  /** The jurisdictions row this hub serves (20260927000000), or null. */
  jurisdiction_ocd_id: string | null;
  /** "Other / not listed": a name with no OCD id, on purpose. */
  jurisdiction_custom: boolean;
};

const OCD_ID_RE = /^ocd-division\/country:us(\/[a-z_]+:[a-z0-9_~.-]+)*$/;

const HOSTNAME_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const JURISDICTION_CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

function refreshCaches(hubId: string): void {
  // In this instance only. Other serverless instances pick changes up when
  // their caches expire (60 s for the registry and for settings), which the
  // console says next to every save.
  invalidateHubCache();
  invalidateHubSettings(hubId);
}

// --- Reading -----------------------------------------------------------------

export async function listHubs(): Promise<ControlHub[]> {
  const { data, error } = await getDb().from("hubs").select(HUB_COLUMNS).order("created_at", { ascending: true });
  if (error) throw new Error(`hubs read failed: ${error.message}`);
  return (data ?? []) as ControlHub[];
}

export async function getHub(id: string): Promise<ControlHub | null> {
  const { data, error } = await getDb().from("hubs").select(HUB_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`hubs read failed: ${error.message}`);
  return (data as ControlHub | null) ?? null;
}

async function settingRows(hubId: string, keys: readonly string[]): Promise<Record<string, string>> {
  const { data, error } = await getDb().from("hub_settings").select("key, value").eq("hub_id", hubId).in("key", [...keys]);
  if (error) throw new Error(`hub_settings read failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ key: string; value: string }>) out[r.key] = r.value;
  return out;
}

async function writeSettings(hubId: string, values: Record<string, string>, actor: string): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ hub_id: hubId, key, value, updated_by: `console:${actor}` }));
  if (rows.length === 0) return;
  const { error } = await getDb().from("hub_settings").upsert(rows, { onConflict: "hub_id,key" });
  if (error) throw new Error(`hub_settings write failed: ${error.message}`);
}

export interface PluginState {
  id: PluginId;
  enabled: boolean;
  /** Where the value comes from: the hub's own row, a deployment env var, or the default (on). */
  source: "hub" | "environment" | "default";
}

function envFallback(key: string): string | undefined {
  for (const name of ENV_FALLBACKS[key] ?? []) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

export async function hubPlugins(hubId: string): Promise<PluginState[]> {
  const keys = PLUGIN_IDS.map((id) => `plugin.${id}.enabled`);
  const stored = await settingRows(hubId, keys);
  return PLUGIN_IDS.map((id) => {
    const key = `plugin.${id}.enabled`;
    if (stored[key] !== undefined) return { id, enabled: asBoolean(stored[key], true), source: "hub" };
    const env = envFallback(key);
    if (env !== undefined) return { id, enabled: asBoolean(env, true), source: "environment" };
    return { id, enabled: true, source: "default" };
  });
}

export async function hubAdmins(hubId: string): Promise<string[]> {
  const stored = await settingRows(hubId, [KEYS.PEOPLE_ADMIN_EMAILS]);
  return asEmailList(stored[KEYS.PEOPLE_ADMIN_EMAILS]);
}

export async function hubGoverningBody(hubId: string): Promise<string> {
  const stored = await settingRows(hubId, [KEYS.COPY_GOVERNING_BODY_NAME]);
  return stored[KEYS.COPY_GOVERNING_BODY_NAME] ?? "";
}

export async function hubJurisdictionType(hubId: string): Promise<JurisdictionType | null> {
  const stored = await settingRows(hubId, [KEYS.IDENTITY_JURISDICTION_TYPE]);
  const v = stored[KEYS.IDENTITY_JURISDICTION_TYPE];
  return isJurisdictionType(v) ? v : null;
}

// --- Validation shared by create and edit -------------------------------------

/**
 * Hostnames that were ever a hub's stay taken, like archived hubs' slugs:
 * old links, published events and DID documents point at them. A hub's
 * current hostname is caught by the unique constraint; a hostname a hub had
 * before an edit lives only in the audit log's `before`, so that is checked.
 */
export async function hostnameTakenBy(hostname: string, exceptHubId?: string): Promise<string | null> {
  const db = getDb();
  const { data: current } = await db.from("hubs").select("id, archived_at").eq("hostname", hostname).maybeSingle();
  const row = current as { id: string; archived_at: string | null } | null;
  if (row && row.id !== exceptHubId) {
    return row.archived_at
      ? `"${hostname}" belongs to the archived hub "${row.id}". An archived hub's hostname stays taken.`
      : `"${hostname}" is already the hostname of hub "${row.id}".`;
  }
  const { data: past } = await db
    .from("control_audit_log")
    .select("target_hub_id")
    .eq("action", "hub.update")
    .eq("before->>hostname", hostname)
    .limit(1);
  const prior = (past ?? []) as Array<{ target_hub_id: string | null }>;
  if (prior.length > 0 && prior[0].target_hub_id !== exceptHubId) {
    return `"${hostname}" was hub "${prior[0].target_hub_id}"'s hostname. A hostname a hub has used stays taken.`;
  }
  return null;
}

export function hostnameShapeProblem(hostname: string): string | null {
  if (!HOSTNAME_RE.test(hostname)) {
    return `"${hostname}" is not a hostname. Lowercase letters, digits, hyphens and dots, with no scheme, port or path.`;
  }
  const consoleHost = consoleHostname();
  if (consoleHost && hostname === consoleHost) return `"${hostname}" is the console's own hostname.`;
  const domain = platformDomain();
  if (domain && hostname.endsWith(`.${domain}`)) {
    const label = hostname.slice(0, -domain.length - 1);
    if (!label.includes(".") && RESERVED_HUB_SLUGS.includes(label)) {
      return `"${hostname}" uses a reserved name under ${domain} and cannot be a hub's hostname.`;
    }
  }
  return null;
}

// --- The MEETING_* / FLOYD_NEWS_* guard --------------------------------------

/** Set, non-empty env vars whose values every hub on the deployment falls back to. */
export function hubSpecificEnvVars(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((k) => /^(MEETING_|FLOYD_NEWS_)/.test(k) && (env[k] ?? "").trim() !== "")
    .sort();
}

/**
 * Why creating a hub here is refused, or null. On the production database,
 * with a hub already there, a MEETING_* or FLOYD_NEWS_* env var would be
 * inherited by the new hub: those are settings fallbacks, read by every hub
 * that has no row of its own. The first hub's values moved into its settings
 * rows at the cutover; the env vars stay only for the rollback week
 * (RUNBOOK §7).
 */
export function productionCreateGuard(existingHubs: number, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProductionDatabase() || existingHubs === 0) return null;
  const vars = hubSpecificEnvVars(env);
  if (vars.length === 0) return null;
  return (
    `Refused: this is the production database, and ${vars.join(", ")} ` +
    `${vars.length === 1 ? "is" : "are"} set on the deployment. Those are fallbacks for every hub, ` +
    `so a new hub would inherit the existing hub's meeting and news sources. Remove them from the ` +
    `Vercel project (that hub's values are in its settings rows now) and redeploy, then create the hub.`
  );
}

// --- Create -----------------------------------------------------------------

export interface CreateHubInput {
  slug: string;
  name: string;
  hostname: string;
  jurisdictionName?: string | null;
  jurisdictionCode?: string | null;
  /** A row of the jurisdictions reference list; null for custom or unset. */
  jurisdictionOcdId?: string | null;
  /** "Other / not listed" (Adam, 2026-09-27): a typed name, no OCD id. */
  jurisdictionCustom?: boolean;
  /** identity.jurisdiction_type (Phase 7). */
  jurisdictionType?: JurisdictionType | null;
  governingBody?: string | null;
  admins: readonly string[];
  mode: HubMode;
  /** Seed the sample content after creating (Phase 7). The form's default is on. */
  sampleContent?: boolean;
  /**
   * The Plugins section of the create form: every plugin, on by default.
   * Written as the hub's own plugin.<id>.enabled rows, so no deployment env
   * fallback decides for a new hub. Omitted = every plugin on.
   */
  plugins?: Partial<Record<PluginId, boolean>>;
}

export interface CreateHubPlan {
  row: Record<string, unknown>;
  settings: Record<string, string>;
}

/** Normalise raw form input. Throws ControlInputError on anything malformed. */
export function parseCreateInput(body: Record<string, unknown>): CreateHubInput {
  const mode = text(body.mode) || "demo";
  if (!isHubMode(mode)) throw new ControlInputError(`"${mode}" is not a mode. Choose demo, beta or live.`);
  const admin = text(body.admin_email).toLowerCase();
  const jurisdictionType = orNull(text(body.jurisdiction_type, 32));
  if (jurisdictionType && !isJurisdictionType(jurisdictionType)) {
    throw new ControlInputError(`"${jurisdictionType}" is not a jurisdiction type.`);
  }
  const custom = body.jurisdiction_custom === true;
  const ocdId = orNull(text(body.jurisdiction_ocd_id, 300));
  if (custom && ocdId) throw new ControlInputError("A custom jurisdiction has no OCD id. Choose one or the other.");
  return {
    slug: text(body.slug, 64).toLowerCase(),
    name: text(body.name),
    hostname: text(body.hostname, 253).toLowerCase(),
    jurisdictionName: orNull(text(body.jurisdiction_name)),
    jurisdictionCode: orNull(text(body.jurisdiction_code, 64).toLowerCase()),
    jurisdictionOcdId: ocdId,
    jurisdictionCustom: custom,
    jurisdictionType: jurisdictionType as JurisdictionType | null,
    governingBody: orNull(text(body.governing_body)),
    admins: admin ? [admin] : [],
    mode,
    sampleContent: body.sample_content === true,
    plugins: body.plugins === undefined ? undefined : parsePluginValues({ plugins: body.plugins }),
  };
}

/**
 * The reference row an OCD id names, or a refusal. The form only offers ids
 * from the list; this is the server's own check.
 */
async function requireJurisdiction(ocdId: string): Promise<{ display_name: string }> {
  if (!OCD_ID_RE.test(ocdId)) throw new ControlInputError(`"${ocdId}" is not an OCD division id.`);
  const row = await getJurisdiction(ocdId);
  if (!row) {
    throw new ControlInputError(
      `"${ocdId}" is not in the jurisdiction list. Load the list (scripts/load-jurisdictions.ts), or choose "Other / not listed".`,
    );
  }
  return row;
}

/** Everything that can be checked before writing. Returns the plan. */
export async function planCreateHub(input: CreateHubInput, allowedModes: readonly HubMode[]): Promise<CreateHubPlan> {
  if (!input.name) throw new ControlInputError("A name is required.");
  const slugProblem = hubSlugRejectionReason(input.slug);
  if (slugProblem) throw new ControlInputError(slugProblem);
  const hostProblem = hostnameShapeProblem(input.hostname);
  if (hostProblem) throw new ControlInputError(hostProblem);
  if (!allowedModes.includes(input.mode)) {
    throw new ControlInputError(`This path cannot create a ${input.mode} hub.`);
  }
  if (input.jurisdictionCode && !JURISDICTION_CODE_RE.test(input.jurisdictionCode)) {
    throw new ControlInputError(`Jurisdiction code "${input.jurisdictionCode}" should look like us-va-<place>: lowercase, hyphens.`);
  }
  const listed = input.jurisdictionOcdId ? await requireJurisdiction(input.jurisdictionOcdId) : null;
  // A listed jurisdiction's display name, unless the form sent its own.
  const jurisdictionName = input.jurisdictionName ?? listed?.display_name ?? null;
  if (input.jurisdictionCustom && !input.jurisdictionName) {
    throw new ControlInputError("Name the custom jurisdiction.");
  }
  // A new hub's place comes from the list or is deliberately custom, never
  // loose free text (Adam, 2026-09-27). No name and no id = no civic geography.
  if (input.jurisdictionName && !input.jurisdictionOcdId && !input.jurisdictionCustom) {
    throw new ControlInputError(
      "Choose the jurisdiction from the list, or mark it Other / not listed (jurisdiction_custom) to type its name.",
    );
  }
  if (input.admins.length === 0) {
    throw new ControlInputError(
      "A first admin email is required. A hub without an admin cannot be administered from its own settings.",
    );
  }
  for (const a of input.admins) {
    if (!EMAIL_RE.test(a)) throw new ControlInputError(`"${a}" is not an email address.`);
  }

  const db = getDb();
  const { data: bySlug } = await db.from("hubs").select("id, archived_at").eq("id", input.slug).maybeSingle();
  if (bySlug) {
    throw new ControlInputError(
      (bySlug as { archived_at: string | null }).archived_at
        ? `"${input.slug}" belongs to an archived hub. An archived hub's slug stays taken.`
        : `A hub "${input.slug}" already exists. Create does not replace.`,
      409,
    );
  }
  const hostTaken = await hostnameTakenBy(input.hostname);
  if (hostTaken) throw new ControlInputError(hostTaken, 409);

  const { count } = await db.from("hubs").select("id", { count: "exact", head: true });
  const guard = productionCreateGuard(count ?? 0);
  if (guard) throw new ControlInputError(guard, 409);

  // `space_did` is the protocol identity on everything this hub publishes:
  // derived from the hostname once, and stable after a hostname change.
  // `protocol_hub_id` (source.hub_id on its events) is derived from the slug
  // once, here; nothing recomputes it later.
  const row = {
    id: input.slug,
    protocol_hub_id: `civic-hub-${input.slug}`,
    hostname: input.hostname,
    name: input.name,
    jurisdiction_code: input.jurisdictionCode ?? null,
    jurisdiction_name: jurisdictionName,
    jurisdiction_ocd_id: input.jurisdictionOcdId ?? null,
    jurisdiction_custom: input.jurisdictionCustom === true,
    space_did: `did:web:${input.hostname}`,
    space_type: "civic-hub",
    status: "active",
    mode: input.mode,
  };

  const settings: Record<string, string> = {
    [KEYS.IDENTITY_NAME]: input.name,
    [KEYS.IDENTITY_LABEL]: "Civic Hub",
    [KEYS.PEOPLE_ADMIN_EMAILS]: encodeList(input.admins),
    [KEYS.LEGAL_OPERATOR_NAME]: input.name,
    [KEYS.EMAIL_FROM_NAME]: input.name,
  };
  if (jurisdictionName) settings[KEYS.IDENTITY_PAGE_TITLE] = `${jurisdictionName} — Civic Hub`;
  if (input.jurisdictionType) settings[KEYS.IDENTITY_JURISDICTION_TYPE] = input.jurisdictionType;
  // The form pre-fills the usual body for the type and the operator may
  // correct it; a caller that sent a type but no body gets the usual one.
  const governingBody =
    input.governingBody ??
    (defaultGoverningBody(input.jurisdictionType, input.jurisdictionCode, input.jurisdictionOcdId) || null);
  if (governingBody) settings[KEYS.COPY_GOVERNING_BODY_NAME] = governingBody;
  // Every plugin gets its own row: what the operator ticked, on by default.
  for (const id of PLUGIN_IDS) {
    settings[`plugin.${id}.enabled`] = input.plugins?.[id] === false ? "false" : "true";
  }

  return { row, settings };
}

/**
 * Create a hub: the registry row and its starter settings, admin roster
 * included (a hub without an admin cannot be fixed from its own UI). If the
 * settings fail to write, the row is removed again, so a half-made hub never
 * resolves.
 */
export async function createHub(
  input: CreateHubInput,
  opts: { allowedModes: readonly HubMode[]; updatedBy: string },
): Promise<{ hub: ControlHub; settings: Record<string, string> }> {
  const plan = await planCreateHub(input, opts.allowedModes);
  const db = getDb();
  const { error: hubErr } = await db.from("hubs").insert(plan.row);
  if (hubErr) throw new ControlInputError(`The hub could not be created: ${hubErr.message}`, 409);
  try {
    await writeSettings(input.slug, plan.settings, opts.updatedBy);
  } catch (err) {
    await db.from("hubs").delete().eq("id", input.slug);
    throw err;
  }
  refreshCaches(input.slug);
  const hub = await getHub(input.slug);
  if (!hub) throw new Error("created hub not found on read-back");
  return { hub, settings: plan.settings };
}

// --- Edit -----------------------------------------------------------------

export interface HubConfigPatch {
  name?: string;
  hostname?: string;
  jurisdiction_code?: string | null;
  jurisdiction_name?: string | null;
  jurisdiction_ocd_id?: string | null;
  jurisdiction_custom?: boolean;
  jurisdiction_type?: JurisdictionType | null;
  governing_body?: string;
  status?: "active" | "suspended";
  mode?: HubMode;
}

export interface HubConfigView {
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  jurisdiction_ocd_id: string | null;
  jurisdiction_custom: boolean;
  jurisdiction_type: JurisdictionType | null;
  governing_body: string;
  status: string;
  mode: string | null;
}

export async function hubConfigView(hub: ControlHub): Promise<HubConfigView> {
  return {
    name: hub.name,
    hostname: hub.hostname,
    jurisdiction_code: hub.jurisdiction_code,
    jurisdiction_name: hub.jurisdiction_name,
    jurisdiction_ocd_id: hub.jurisdiction_ocd_id ?? null,
    jurisdiction_custom: hub.jurisdiction_custom === true,
    jurisdiction_type: await hubJurisdictionType(hub.id),
    governing_body: await hubGoverningBody(hub.id),
    status: hub.status,
    mode: hub.mode,
  };
}

export function parseConfigPatch(body: Record<string, unknown>): HubConfigPatch {
  const patch: HubConfigPatch = {};
  if ("name" in body) patch.name = text(body.name);
  if ("hostname" in body) patch.hostname = text(body.hostname, 253).toLowerCase();
  if ("jurisdiction_code" in body) patch.jurisdiction_code = orNull(text(body.jurisdiction_code, 64).toLowerCase());
  if ("jurisdiction_name" in body) patch.jurisdiction_name = orNull(text(body.jurisdiction_name));
  if ("jurisdiction_ocd_id" in body) patch.jurisdiction_ocd_id = orNull(text(body.jurisdiction_ocd_id, 300));
  if ("jurisdiction_custom" in body) {
    if (typeof body.jurisdiction_custom !== "boolean") throw new ControlInputError("jurisdiction_custom is true or false.");
    patch.jurisdiction_custom = body.jurisdiction_custom;
  }
  if ("jurisdiction_type" in body) {
    const t = orNull(text(body.jurisdiction_type, 32));
    if (t && !isJurisdictionType(t)) throw new ControlInputError(`"${t}" is not a jurisdiction type.`);
    patch.jurisdiction_type = t as JurisdictionType | null;
  }
  if ("governing_body" in body) patch.governing_body = text(body.governing_body);
  if ("status" in body) {
    const s = text(body.status);
    if (s !== "active" && s !== "suspended") throw new ControlInputError("Status is active or suspended.");
    patch.status = s;
  }
  if ("mode" in body) {
    const m = text(body.mode);
    if (!isHubMode(m)) throw new ControlInputError(`"${m}" is not a mode.`);
    patch.mode = m;
  }
  return patch;
}

/** The fields of `patch` that actually change `before`. */
export function changedFields(before: HubConfigView, patch: HubConfigPatch): Partial<HubConfigView> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && (before as unknown as Record<string, unknown>)[k] !== v) out[k] = v;
  }
  return out as Partial<HubConfigView>;
}

/**
 * Changes that take step-up: moving a hub's address (old links break),
 * pausing it, and changing who may sign in (its mode).
 */
export function configChangeNeedsStepUp(changes: Partial<HubConfigView>): boolean {
  return changes.hostname !== undefined || changes.status === "suspended" || changes.mode !== undefined;
}

/** Everything that can refuse a config change, checked before step-up is spent. */
export async function validateHubConfig(hub: ControlHub, changes: Partial<HubConfigView>): Promise<void> {
  if (hub.archived_at && changes.status === "active") {
    throw new ControlInputError("This hub is archived. Unarchive it rather than setting it active.");
  }
  if (changes.name !== undefined && !changes.name) throw new ControlInputError("A name is required.");
  if (changes.hostname !== undefined) {
    const problem = hostnameShapeProblem(changes.hostname) ?? (await hostnameTakenBy(changes.hostname, hub.id));
    if (problem) throw new ControlInputError(problem, 409);
  }
  if (changes.jurisdiction_code && !JURISDICTION_CODE_RE.test(changes.jurisdiction_code)) {
    throw new ControlInputError(`Jurisdiction code "${changes.jurisdiction_code}" should look like us-va-<place>: lowercase, hyphens.`);
  }
  if (changes.jurisdiction_ocd_id) await requireJurisdiction(changes.jurisdiction_ocd_id);
  // The result, not the patch, must be consistent: custom means no OCD id.
  const ocdAfter = changes.jurisdiction_ocd_id !== undefined ? changes.jurisdiction_ocd_id : hub.jurisdiction_ocd_id;
  const customAfter = changes.jurisdiction_custom !== undefined ? changes.jurisdiction_custom : hub.jurisdiction_custom;
  if (customAfter && ocdAfter) {
    throw new ControlInputError("A custom jurisdiction has no OCD id. Clear the id, or untick Other / not listed.");
  }
  if (changes.mode !== undefined && !ADMIN_SETTABLE_HUB_MODES.includes(changes.mode as HubMode)) {
    // The database refuses any move INTO demo too (hubs_forbid_entering_demo).
    throw new ControlInputError("A hub becomes a demo only when it is created. Choose beta or live.");
  }
}

export async function updateHubConfig(
  hub: ControlHub,
  changes: Partial<HubConfigView>,
  actor: string,
): Promise<void> {
  await validateHubConfig(hub, changes);

  const row: Record<string, unknown> = {};
  for (const k of [
    "name",
    "hostname",
    "jurisdiction_code",
    "jurisdiction_name",
    "jurisdiction_ocd_id",
    "jurisdiction_custom",
    "status",
    "mode",
  ] as const) {
    if (changes[k] !== undefined) row[k] = changes[k];
  }
  if (Object.keys(row).length > 0) {
    const { error } = await getDb().from("hubs").update(row).eq("id", hub.id);
    if (error) throw new ControlInputError(error.message, 409);
  }
  if (changes.governing_body !== undefined) {
    await writeSettings(hub.id, { [KEYS.COPY_GOVERNING_BODY_NAME]: changes.governing_body }, actor);
  }
  if (changes.jurisdiction_type !== undefined) {
    await writeSettings(hub.id, { [KEYS.IDENTITY_JURISDICTION_TYPE]: changes.jurisdiction_type ?? "" }, actor);
  }
  refreshCaches(hub.id);
}

// --- Plugins -----------------------------------------------------------------

/** `{ vote: true, wordcloud: false }` → the rows to write; unknown ids refused. */
export function parsePluginValues(body: unknown): Partial<Record<PluginId, boolean>> {
  const values = (body as { plugins?: unknown })?.plugins;
  if (!values || typeof values !== "object") throw new ControlInputError("Send { plugins: { <id>: true|false } }.");
  const out: Partial<Record<PluginId, boolean>> = {};
  for (const [id, v] of Object.entries(values as Record<string, unknown>)) {
    if (!isPluginId(id)) throw new ControlInputError(`"${id}" is not a plugin.`);
    if (typeof v !== "boolean") throw new ControlInputError(`${id}: send true or false.`);
    out[id] = v;
  }
  return out;
}

export async function setHubPlugins(hubId: string, values: Partial<Record<PluginId, boolean>>, actor: string): Promise<void> {
  const rows: Record<string, string> = {};
  for (const [id, on] of Object.entries(values)) rows[`plugin.${id}.enabled`] = on ? "true" : "false";
  await writeSettings(hubId, rows, actor);
  refreshCaches(hubId);
}

// --- Admins -----------------------------------------------------------------

export function parseAdminList(body: unknown): string[] {
  const raw = (body as { admins?: unknown })?.admins;
  if (!Array.isArray(raw)) throw new ControlInputError("Send { admins: [<email>, ...] }.");
  const list = [...new Set(raw.map((e) => text(e).toLowerCase()).filter(Boolean))];
  for (const e of list) if (!EMAIL_RE.test(e)) throw new ControlInputError(`"${e}" is not an email address.`);
  if (list.length === 0) {
    throw new ControlInputError("A hub needs at least one admin; its own settings cannot be reached without one.");
  }
  return list;
}

export async function setHubAdmins(hubId: string, admins: readonly string[], actor: string): Promise<void> {
  await writeSettings(hubId, { [KEYS.PEOPLE_ADMIN_EMAILS]: encodeList(admins) }, actor);
  refreshCaches(hubId);
}

// --- Archive -----------------------------------------------------------------

export async function archiveHub(hub: ControlHub): Promise<void> {
  if (hub.archived_at) throw new ControlInputError("This hub is already archived.");
  const { error } = await getDb()
    .from("hubs")
    .update({ archived_at: new Date().toISOString(), status: "suspended" })
    .eq("id", hub.id);
  if (error) throw new Error(`archive failed: ${error.message}`);
  refreshCaches(hub.id);
}

/**
 * Clears archived_at. The hub stays suspended: serving it again is a
 * separate, deliberate step (set its status to active).
 */
export async function unarchiveHub(hub: ControlHub): Promise<void> {
  if (!hub.archived_at) throw new ControlInputError("This hub is not archived.");
  const { error } = await getDb().from("hubs").update({ archived_at: null }).eq("id", hub.id);
  if (error) throw new Error(`unarchive failed: ${error.message}`);
  refreshCaches(hub.id);
}
