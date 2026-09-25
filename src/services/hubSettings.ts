// Hub settings service — every per-hub configuration value comes from here.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings".
// Key names, aliases, env fallbacks and value encoding live in
// src/models/hubSettings.ts; storage lives in src/db/hubSettingsStore.ts.
// This module is the only thing either of those is for.
//
// RESOLUTION ORDER for every read, in order:
//   1. the hub's row under the canonical dotted key
//   2. the hub's row under the legacy alias key, if the key has one
//   3. the environment variable(s) the key falls back to
//   4. the caller's default
//
// Step 3 is the bridge, not the destination. It is what lets a deployment
// that has not been seeded behave exactly as it did before, and what makes a
// single-hub self-host with no settings rows a supported configuration.
//
// TWO SHAPES OF READ, on purpose:
//
//   getX(hubId)      async, hits the cached store. Use when you have a hub id
//                    and may not be inside a request — crons, scripts, admin
//                    writes.
//   getXSync()       synchronous, reads the request-scoped snapshot the
//                    resolver loaded. Use on hot paths inside a request.
//                    Returns the env/default answer outside a request rather
//                    than throwing, so a script that calls one still works.
//
// Both go through the same resolution order, so they cannot disagree.

import {
  fetchHubSettings,
  fetchHubSettingRows,
  writeHubSetting,
  writeHubSettings,
  invalidateHubSettings,
  type SettingsMap,
} from "../db/hubSettingsStore.js";
import { currentHub, currentHubSettings } from "../config/hubContext.js";
import { hubName } from "../config/hub.js";
import { isHubMode, type HubMode } from "../models/hub.js";
import {
  KEYS,
  KEY_ALIASES,
  ENV_FALLBACKS,
  asBoolean,
  asEmailList,
  asList,
  asNumber,
  encodeList,
  publicSubset,
  PUBLIC_KEY_LIST,
  PLUGIN_IDS,
} from "../models/hubSettings.js";

export { KEYS, publicSubset, invalidateHubSettings };
export type { SettingsMap };

/**
 * Legacy export. The old flat key names, kept so existing imports compile
 * while the call sites move over.
 *
 * @deprecated Use KEYS from src/models/hubSettings.ts.
 */
export const SETTING_KEYS = {
  VOTE_RESULTS_RECIPIENT_EMAILS: KEYS.PEOPLE_BRIEF_RECIPIENTS,
  ANNOUNCEMENT_AUTHORS: KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS,
  BETA_ALLOWLIST: KEYS.BETA_ALLOWLIST,
  SUPPORT_THRESHOLD: KEYS.PLUGIN_VOTE_SUPPORT_THRESHOLD,
  COMMENT_IDENTITY_MODE: KEYS.MODERATION_COMMENT_IDENTITY_MODE,
  OFFICIALS_MIGRATED: KEYS.PEOPLE_OFFICIALS_MIGRATED,
} as const;

// --- resolution -----------------------------------------------------------

function fromEnv(key: string): string | undefined {
  for (const name of ENV_FALLBACKS[key] ?? []) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Steps 1-3 against an already-loaded map. */
function resolve(map: SettingsMap | null, key: string): string | undefined {
  if (map) {
    const direct = map[key];
    if (direct !== undefined && direct !== "") return direct;
    const alias = KEY_ALIASES[key];
    if (alias) {
      const aliased = map[alias];
      if (aliased !== undefined && aliased !== "") return aliased;
    }
  }
  return fromEnv(key);
}

// --- generic accessors ----------------------------------------------------

/**
 * One raw value for a named hub, or undefined.
 *
 * `hubId` may be null — a cron, a script or a test that has no hub in scope.
 * The read then skips the database and answers from the env fallbacks, which
 * is the behaviour every one of these values had before it became a setting.
 * Writes take a non-null hub, because a write that does not know its hub must
 * not guess.
 */
export async function getSetting(
  hubId: string | null,
  key: string,
): Promise<string | undefined> {
  if (!hubId) return fromEnv(key);
  return resolve(await fetchHubSettings(hubId), key);
}

/** One raw value for the hub serving this request, or undefined. */
export function getSettingSync(key: string): string | undefined {
  return resolve(currentHubSettings(), key);
}

/** Write one value for a named hub. Always writes the canonical key. */
export async function setSetting(
  hubId: string,
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  await writeHubSetting(hubId, key, value, updatedBy);
}

/** Write many values for a named hub in one round trip. */
export async function setSettings(
  hubId: string,
  entries: ReadonlyArray<{ key: string; value: string }>,
  updatedBy: string | null,
): Promise<void> {
  await writeHubSettings(hubId, entries, updatedBy);
}

/** Every stored row for a hub, with metadata. Admin surface only. */
export async function getAllSettings(hubId: string): Promise<
  Record<
    string,
    { key: string; value: string; updated_at: string; updated_by: string | null }
  >
> {
  const rows = await fetchHubSettingRows(hubId);
  const out: Record<
    string,
    { key: string; value: string; updated_at: string; updated_by: string | null }
  > = {};
  for (const row of rows) out[row.key] = row;
  return out;
}

/**
 * The public settings for a hub, each one fully resolved.
 *
 * Resolves key by key rather than filtering the stored map, because a value
 * may come from the row, from the legacy alias, or from the env fallback, and
 * only the resolution order knows which. Keys with no value anywhere are
 * omitted, so "absent" means "not configured" rather than "empty".
 *
 * Document-sized keys are included here only if a hub has overridden them;
 * the defaults are shared files served by the documents endpoint.
 */
export async function getPublicSettings(
  hubId: string | null,
): Promise<Record<string, string>> {
  const map = hubId ? await fetchHubSettings(hubId) : null;
  const out: Record<string, string> = {};

  for (const key of PUBLIC_KEY_LIST) {
    const value = resolve(map, key);
    if (value !== undefined && value !== "") out[key] = value;
  }
  for (const id of PLUGIN_IDS) {
    const key = `plugin.${id}.enabled`;
    out[key] = asBoolean(resolve(map, key), true) ? "true" : "false";
  }
  return out;
}

/** Everything resolved for a hub, for the public config endpoint. */
export async function getResolvedSettings(
  hubId: string | null,
): Promise<SettingsMap> {
  return hubId ? fetchHubSettings(hubId) : {};
}

// --- identity and copy ----------------------------------------------------

export function getBannerUrl(): string | undefined {
  return getSettingSync(KEYS.IDENTITY_BANNER_URL);
}

// --- the operator -----------------------------------------------------------
//
// Who is answerable for this hub, and where to reach them. The four legal
// documents substitute both in, so a hub states each once rather than three
// times across three documents — which is how Floyd's name and address came
// to be written into the shared templates as literals and served on Athens.
//
// Free text, both of them. An operator may be a person, a committee or a
// town; a contact address may be a shared inbox. Neither has an env fallback:
// there was never a variable for them, and inventing one now would mean a
// deployment could put one hub's operator on another hub's terms page, which
// is the bug being fixed.

export async function getOperatorName(hubId: string | null): Promise<string> {
  return (await getSetting(hubId, KEYS.LEGAL_OPERATOR_NAME)) ?? "";
}

export async function getContactEmail(hubId: string | null): Promise<string> {
  return (await getSetting(hubId, KEYS.LEGAL_CONTACT_EMAIL)) ?? "";
}

export async function setOperatorName(
  hubId: string,
  name: string,
  updatedBy: string | null,
): Promise<string> {
  const cleaned = name.trim();
  await setSetting(hubId, KEYS.LEGAL_OPERATOR_NAME, cleaned, updatedBy);
  return cleaned;
}

/**
 * The "who runs this site" paragraph, or "" when the hub has not written one
 * and is therefore showing the shared default.
 *
 * Empty means "using the default" rather than "blank", so the admin form can
 * show the default as a placeholder and a hub can return to it by clearing
 * the field.
 */
export async function getWhoRunsThis(hubId: string | null): Promise<string> {
  return (await getSetting(hubId, KEYS.LEGAL_WHO_RUNS_THIS)) ?? "";
}

export async function setWhoRunsThis(
  hubId: string,
  text: string,
  updatedBy: string | null,
): Promise<string> {
  const cleaned = text.trim();
  await setSetting(hubId, KEYS.LEGAL_WHO_RUNS_THIS, cleaned, updatedBy);
  return cleaned;
}

export async function setContactEmail(
  hubId: string,
  email: string,
  updatedBy: string | null,
): Promise<string> {
  const cleaned = email.trim().toLowerCase();
  await setSetting(hubId, KEYS.LEGAL_CONTACT_EMAIL, cleaned, updatedBy);
  return cleaned;
}

// --- people ---------------------------------------------------------------

/**
 * Admin email addresses for the hub serving this request.
 *
 * Synchronous because it gates fourteen call sites, several on read paths
 * that run for every visitor. An Athens admin is not a Floyd admin: the list
 * is per hub, and outside a request this falls back to CIVIC_ADMIN_EMAILS so
 * crons and scripts keep the behaviour they had.
 */
export function getAdminEmailsSync(): string[] {
  return asEmailList(getSettingSync(KEYS.PEOPLE_ADMIN_EMAILS));
}

export function getBoardEmailsSync(): string[] {
  return asEmailList(getSettingSync(KEYS.PEOPLE_BOARD_EMAILS));
}

export async function getAdminEmails(hubId: string | null): Promise<string[]> {
  return asEmailList(await getSetting(hubId, KEYS.PEOPLE_ADMIN_EMAILS));
}

export async function setAdminEmails(
  hubId: string,
  emails: readonly string[],
  updatedBy: string | null,
): Promise<string[]> {
  const cleaned = asEmailList(encodeList([...emails]));
  await setSetting(hubId, KEYS.PEOPLE_ADMIN_EMAILS, encodeList(cleaned), updatedBy);
  return cleaned;
}

export async function getBoardEmails(hubId: string | null): Promise<string[]> {
  return asEmailList(await getSetting(hubId, KEYS.PEOPLE_BOARD_EMAILS));
}

export async function setBoardEmails(
  hubId: string,
  emails: readonly string[],
  updatedBy: string | null,
): Promise<string[]> {
  const cleaned = asEmailList(encodeList([...emails]));
  await setSetting(hubId, KEYS.PEOPLE_BOARD_EMAILS, encodeList(cleaned), updatedBy);
  return cleaned;
}

/**
 * Is this hub's admin roster still the deployment's bootstrap?
 *
 * True when the hub has written no `people.admin_emails` row, so the answer
 * is coming from CIVIC_ADMIN_EMAILS — which every unseeded hub on the same
 * deployment shares. The admin panel says so rather than presenting a list
 * that looks like this hub's own.
 */
export async function adminsAreFromEnv(hubId: string): Promise<boolean> {
  try {
    const rows = await getAllSettings(hubId);
    return rows[KEYS.PEOPLE_ADMIN_EMAILS] === undefined;
  } catch {
    // Unable to tell — do not claim the roster belongs to the hub.
    return true;
  }
}

/**
 * Vote-results recipients. Trimmed, deduped, non-empty; an empty result means
 * no recipient is configured anywhere.
 */
export async function getVoteResultsRecipients(hubId: string | null): Promise<string[]> {
  const stored = await getSetting(hubId, KEYS.PEOPLE_BRIEF_RECIPIENTS);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of asList(stored)) {
    const lower = entry.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(entry);
  }
  return out;
}

export async function setVoteResultsRecipients(
  hubId: string,
  emails: readonly string[],
  updatedBy: string | null,
): Promise<string[]> {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of emails) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleaned.push(trimmed);
  }
  await setSetting(
    hubId,
    KEYS.PEOPLE_BRIEF_RECIPIENTS,
    encodeList(cleaned),
    updatedBy,
  );
  return cleaned;
}

/**
 * A non-admin user the admin has authorized to post announcements. `label` is
 * rendered verbatim next to their name, so a hub can use "Board member",
 * "Planning Committee", "Guest speaker" or anything else.
 *
 * Admins always post, and always display as "Admin", whether or not they
 * appear here.
 */
export interface AnnouncementAuthor {
  email: string;
  /** Admin-curated display name. Falls back to the poster's account name. */
  name?: string;
  label: string;
}

export async function getAnnouncementAuthors(
  hubId: string | null,
): Promise<AnnouncementAuthor[]> {
  const stored = await getSetting(hubId, KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every((e) => typeof e === "object")) {
        return normalizeAuthors(parsed);
      }
    } catch {
      // A corrupt row must not lock out board members who posted yesterday.
    }
  }
  // Board emails, each labelled generically, so a hub that has only ever set
  // the roster still has working authors.
  const board = await getSetting(hubId, KEYS.PEOPLE_BOARD_EMAILS);
  return normalizeAuthors(
    asList(board).map((email) => ({ email, label: "Board member" })),
  );
}

export async function setAnnouncementAuthors(
  hubId: string,
  authors: readonly AnnouncementAuthor[],
  updatedBy: string | null,
): Promise<AnnouncementAuthor[]> {
  const cleaned = normalizeAuthors([...authors]);
  await setSetting(
    hubId,
    KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS,
    JSON.stringify(cleaned),
    updatedBy,
  );
  return cleaned;
}

/** Trim, dedup by lowercase email, drop empty. Preserve caller order. */
function normalizeAuthors(raw: unknown[]): AnnouncementAuthor[] {
  const seen = new Set<string>();
  const out: AnnouncementAuthor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { email?: unknown; name?: unknown; label?: unknown };
    const email = typeof e.email === "string" ? e.email.trim() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!email || !label) continue;
    const lower = email.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name ? { email, name, label } : { email, label });
  }
  return out;
}

export async function lookupAuthor(
  hubId: string | null,
  email: string | undefined | null,
): Promise<AnnouncementAuthor | null> {
  if (!email) return null;
  const lower = email.toLowerCase();
  for (const a of await getAnnouncementAuthors(hubId)) {
    if (a.email.toLowerCase() === lower) return a;
  }
  return null;
}

export async function lookupAuthorLabel(
  hubId: string | null,
  email: string | undefined | null,
): Promise<string | null> {
  return (await lookupAuthor(hubId, email))?.label ?? null;
}

// --- officials migration latch -------------------------------------------

/**
 * True once the officials roster lives on user rows. Anything unreadable
 * means "not yet", which keeps the legacy fallbacks live — failing toward
 * people still being able to post, never toward locking them out.
 */
export async function areOfficialsMigrated(hubId: string | null): Promise<boolean> {
  try {
    return (await getSetting(hubId, KEYS.PEOPLE_OFFICIALS_MIGRATED)) === "true";
  } catch {
    return false;
  }
}

export async function setOfficialsMigrated(
  hubId: string,
  updatedBy: string | null,
): Promise<void> {
  await setSetting(hubId, KEYS.PEOPLE_OFFICIALS_MIGRATED, "true", updatedBy);
}

// --- email ----------------------------------------------------------------

export function getEmailFromNameSync(): string | undefined {
  return getSettingSync(KEYS.EMAIL_FROM_NAME);
}

export function getEmailFromAddressSync(): string | undefined {
  return getSettingSync(KEYS.EMAIL_FROM_ADDRESS);
}

export function getPostalAddressSync(): string | undefined {
  return getSettingSync(KEYS.EMAIL_POSTAL_ADDRESS);
}

// --- beta -----------------------------------------------------------------

export async function getBetaAllowlist(hubId: string | null): Promise<string[]> {
  return asEmailList(await getSetting(hubId, KEYS.BETA_ALLOWLIST));
}

export async function setBetaAllowlist(
  hubId: string,
  emails: readonly string[],
  updatedBy: string | null,
): Promise<string[]> {
  const cleaned = asEmailList(encodeList([...emails]));
  await setSetting(hubId, KEYS.BETA_ALLOWLIST, encodeList(cleaned), updatedBy);
  return cleaned;
}

export async function isEmailOnBetaAllowlist(
  hubId: string | null,
  email: string,
): Promise<boolean> {
  return (await getBetaAllowlist(hubId)).includes(email.trim().toLowerCase());
}

/**
 * The hub's lifecycle state — demo, beta or live.
 *
 * THE DATABASE IS THE ONLY SOURCE (hardening pass, 2026-09-22). There is no
 * environment fallback and no way to influence this from a deployment's
 * configuration. `hubs.mode` is NOT NULL, so a hub always has one, and an
 * environment variable can no longer decide whether a hub checks email
 * addresses — which is the property that makes the demo relaxation safe to
 * have at all.
 *
 * Outside a request there is no hub, and the answer is "live": the strictest
 * of the three, because code with no hub in scope must not assume it is
 * allowed to skip verification.
 */
export function hubModeSync(): HubMode {
  return hubModeFor(currentHub());
}

/** The mode of a given hub row, for code that has one but is not in a request. */
export function hubModeFor(hub: { mode?: string | null } | null): HubMode {
  return isHubMode(hub?.mode) ? hub.mode : "live";
}

/**
 * Is this hub in private beta? Sign-in is limited to the allowlist, and
 * everyone else is offered the waitlist.
 */
export function isBetaEnabledSync(): boolean {
  return hubModeSync() === "beta";
}

/**
 * Is this hub a demo? A demo hub does not email sign-in codes and accepts any
 * six digits, so a visitor can look around without an inbox. There is no code
 * to display or leak.
 */
export function isDemoHubSync(): boolean {
  return hubModeSync() === "demo";
}

// --- moderation -----------------------------------------------------------

/**
 * Hub-wide identity policy for community comments:
 *   real_name          — every comment carries the author's real name
 *   anonymous_optional — real name by default, resident may opt into
 *                        anonymity per comment (launch default)
 *   anonymous_only     — all comments are anonymous
 *
 * Votes are always ballot-secret and process creation is always real-name.
 * Those are structural, not settings; this key only governs comments.
 */
export type CommentIdentityMode =
  | "real_name"
  | "anonymous_optional"
  | "anonymous_only";

export const COMMENT_IDENTITY_MODES: CommentIdentityMode[] = [
  "real_name",
  "anonymous_optional",
  "anonymous_only",
];

const DEFAULT_COMMENT_IDENTITY_MODE: CommentIdentityMode = "anonymous_optional";

function coerceIdentityMode(raw: string | undefined): CommentIdentityMode {
  if (raw && (COMMENT_IDENTITY_MODES as string[]).includes(raw)) {
    return raw as CommentIdentityMode;
  }
  return DEFAULT_COMMENT_IDENTITY_MODE;
}

export async function getCommentIdentityMode(
  hubId: string | null,
): Promise<CommentIdentityMode> {
  return coerceIdentityMode(
    await getSetting(hubId, KEYS.MODERATION_COMMENT_IDENTITY_MODE),
  );
}

export function getCommentIdentityModeSync(): CommentIdentityMode {
  return coerceIdentityMode(
    getSettingSync(KEYS.MODERATION_COMMENT_IDENTITY_MODE),
  );
}

export async function setCommentIdentityMode(
  hubId: string,
  mode: string,
  updatedBy: string | null,
): Promise<CommentIdentityMode> {
  if (!(COMMENT_IDENTITY_MODES as string[]).includes(mode)) {
    throw new Error(
      `Invalid comment identity mode "${mode}". Valid: ${COMMENT_IDENTITY_MODES.join(", ")}`,
    );
  }
  await setSetting(
    hubId,
    KEYS.MODERATION_COMMENT_IDENTITY_MODE,
    mode,
    updatedBy,
  );
  return mode as CommentIdentityMode;
}

// --- display name ---------------------------------------------------------

/**
 * What the hub calls itself: `identity.name` when the hub has chosen one, the
 * registry name (`hubs.name`) otherwise. The server-side twin of the UI's
 * `hub.name` getter and of `{HUB_NAME}` in hub documents — email subjects and
 * assistant prompts use this so a resident sees one name everywhere.
 */
export function hubDisplayNameSync(): string {
  return getSettingSync(KEYS.IDENTITY_NAME)?.trim() || hubName();
}

// --- plugin settings ------------------------------------------------------

/** Everything is on unless a hub explicitly switches it off. */
export function isPluginEnabledSync(pluginId: string): boolean {
  return asBoolean(getSettingSync(`plugin.${pluginId}.enabled`), true);
}

export async function isPluginEnabled(
  hubId: string | null,
  pluginId: string,
): Promise<boolean> {
  return asBoolean(await getSetting(hubId, `plugin.${pluginId}.enabled`), true);
}

/**
 * The range of voting windows a resident may choose on this hub, in days, and
 * where a new draft starts. Unset keys keep the numbers that were in code
 * before they were settings (14, 90, 42). A range an admin set backwards is
 * put the right way round, and the default is kept inside it, so a
 * half-edited range can never make every duration invalid.
 */
export const VOTE_DURATION_DEFAULTS = { minDays: 14, maxDays: 90, defaultDays: 42 } as const;
const DURATION_DAYS_CEILING = 365;

export function voteDurationLimitsSync(): { minDays: number; maxDays: number; defaultDays: number } {
  const days = (key: string, fallback: number) => {
    const n = asNumber(getSettingSync(key), fallback);
    return Number.isInteger(n) && n >= 1 && n <= DURATION_DAYS_CEILING ? n : fallback;
  };
  let minDays = days(KEYS.PLUGIN_VOTE_MIN_DURATION_DAYS, VOTE_DURATION_DEFAULTS.minDays);
  let maxDays = days(KEYS.PLUGIN_VOTE_MAX_DURATION_DAYS, VOTE_DURATION_DEFAULTS.maxDays);
  if (minDays > maxDays) [minDays, maxDays] = [maxDays, minDays];
  const wanted = days(KEYS.PLUGIN_VOTE_DEFAULT_DURATION_DAYS, VOTE_DURATION_DEFAULTS.defaultDays);
  const defaultDays = Math.min(maxDays, Math.max(minDays, wanted));
  return { minDays, maxDays, defaultDays };
}

/**
 * Endorsements a resident-submitted vote needs before it opens for ballots.
 * Read once at submission and snapshotted onto the vote, so changing it never
 * moves a vote that is already gathering support. 0 means no support phase:
 * approval opens the vote directly.
 */
const DEFAULT_SUPPORT_THRESHOLD = 5;

export async function getSupportThreshold(hubId: string | null): Promise<number> {
  const n = asNumber(
    await getSetting(hubId, KEYS.PLUGIN_VOTE_SUPPORT_THRESHOLD),
    DEFAULT_SUPPORT_THRESHOLD,
  );
  return n >= 0 ? n : DEFAULT_SUPPORT_THRESHOLD;
}

export async function setSupportThreshold(
  hubId: string,
  value: number,
  updatedBy: string | null,
): Promise<number> {
  const clamped = Math.max(0, Math.round(value));
  await setSetting(
    hubId,
    KEYS.PLUGIN_VOTE_SUPPORT_THRESHOLD,
    String(clamped),
    updatedBy,
  );
  return clamped;
}

// --- waitlist -------------------------------------------------------------
//
// Not a setting — a table — but it has always lived behind this module's
// front door and the admin surface reads it alongside the settings.

export interface WaitlistEntry {
  email: string;
  created_at: string;
  name: string | null;
  notes: string | null;
  wants_test_user: boolean;
}

export { getWaitlist } from "../db/waitlistStore.js";
