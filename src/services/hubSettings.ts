// Hub settings service — read/write for the hub_settings key-value table.
//
// First consumer: vote-results recipient emails (the Board of Supervisors,
// historically). The admin UI writes here, the vote-results approval
// flow reads here first and falls back to the BOARD_RECIPIENT_EMAIL
// env var if no row exists yet.
//
// Extendable: add more keys as other admin-configurable settings appear.

import { getDb } from "../db/client.js";

// IMPORTANT: the underlying DB key remains "brief_recipient_emails" for
// historical reasons — it predates Slice 8.5's rename and live operator
// configurations already use this name. Renaming the storage key would
// require a separate hub_settings migration and operator coordination,
// neither of which is in scope here. Only the JS/TS function name was
// updated for code-level clarity.
export const SETTING_KEYS = {
  VOTE_RESULTS_RECIPIENT_EMAILS: "brief_recipient_emails",
  ANNOUNCEMENT_AUTHORS: "announcement_authors",
  BETA_ALLOWLIST: "beta_allowlist",
  SUPPORT_THRESHOLD: "support_threshold",
  COMMENT_IDENTITY_MODE: "comment_identity_mode",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * A non-admin user the admin has authorized to post Civic Hub
 * announcements. `label` is rendered verbatim on the feed and the public
 * announcement page ("{label} announcement: …", eyebrow "{LABEL}
 * ANNOUNCEMENT"). Free-form so a hub can use "Board member", "Planning
 * Committee", "Guest speaker", etc.
 *
 * Admins always post and are displayed as "Admin" regardless of whether
 * they appear in this list.
 */
export interface AnnouncementAuthor {
  email: string;
  /** Admin-curated display name for this author. Optional — falls back to
   *  the poster's own account name when blank. */
  name?: string;
  label: string;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await getDb()
    .from("hub_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`hubSettings.get: ${error.message}`);
  return (data as { value: string } | null)?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  const { error } = await getDb()
    .from("hub_settings")
    .upsert({ key, value, updated_by: updatedBy }, { onConflict: "key" });
  if (error) throw new Error(`hubSettings.set: ${error.message}`);
}

export async function getAllSettings(): Promise<Record<string, SettingRow>> {
  const { data, error } = await getDb()
    .from("hub_settings")
    .select("*");
  if (error) throw new Error(`hubSettings.getAll: ${error.message}`);
  const out: Record<string, SettingRow> = {};
  for (const row of (data ?? []) as SettingRow[]) {
    out[row.key] = row;
  }
  return out;
}

/**
 * Resolve the vote-results recipient list — DB setting first,
 * BOARD_RECIPIENT_EMAIL env var as a safety-net fallback. Returns a
 * trimmed, deduped, non-empty list. Empty result means "no recipient
 * configured anywhere".
 */
export async function getVoteResultsRecipients(): Promise<string[]> {
  const stored = await getSetting(SETTING_KEYS.VOTE_RESULTS_RECIPIENT_EMAILS);
  const raw = stored ?? process.env.BOARD_RECIPIENT_EMAIL ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

export async function setVoteResultsRecipients(
  emails: string[],
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
    SETTING_KEYS.VOTE_RESULTS_RECIPIENT_EMAILS,
    cleaned.join(","),
    updatedBy,
  );
  return cleaned;
}

/**
 * Read the admin-configured author list. Falls back to the
 * CIVIC_BOARD_EMAILS env var (each entry labeled "Board member") when no
 * DB row exists, so deploys before an admin has visited the settings
 * panel keep working with their prior env-var configuration.
 */
export async function getAnnouncementAuthors(): Promise<AnnouncementAuthor[]> {
  const stored = await getSetting(SETTING_KEYS.ANNOUNCEMENT_AUTHORS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeAuthors(parsed);
      }
    } catch {
      // Fall through to env var — corrupt row shouldn't lock out Board
      // members who worked yesterday.
    }
  }
  // Env var fallback: CIVIC_BOARD_EMAILS → all entries labeled "Board member"
  const envRaw = process.env.CIVIC_BOARD_EMAILS ?? "";
  const envList = envRaw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .map((email) => ({ email, label: "Board member" }));
  return normalizeAuthors(envList);
}

export async function setAnnouncementAuthors(
  authors: AnnouncementAuthor[],
  updatedBy: string | null,
): Promise<AnnouncementAuthor[]> {
  const cleaned = normalizeAuthors(authors);
  await setSetting(
    SETTING_KEYS.ANNOUNCEMENT_AUTHORS,
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
    // Store name only when present, so existing { email, label } rows stay clean.
    out.push(name ? { email, name, label } : { email, label });
  }
  return out;
}

// --- Beta allowlist ---

export interface WaitlistEntry {
  email: string;
  created_at: string;
  notes: string | null;
}

export async function getBetaAllowlist(): Promise<string[]> {
  const stored = await getSetting(SETTING_KEYS.BETA_ALLOWLIST);
  const raw = stored ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export async function setBetaAllowlist(
  emails: string[],
  updatedBy: string | null,
): Promise<string[]> {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of emails) {
    const trimmed = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  await setSetting(SETTING_KEYS.BETA_ALLOWLIST, cleaned.join(","), updatedBy);
  return cleaned;
}

export async function isEmailOnBetaAllowlist(
  email: string,
): Promise<boolean> {
  const list = await getBetaAllowlist();
  return list.includes(email.trim().toLowerCase());
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await getDb()
    .from("waitlist")
    .select("email, created_at, notes")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`hubSettings.getWaitlist: ${error.message}`);
  return (data ?? []) as WaitlistEntry[];
}

// --- Announcement authors ---

/**
 * Look up an email in the announcement author list. Returns the label to
 * stamp on new announcements and render on their public page, or null if
 * the email isn't authorized.
 */
export async function lookupAuthorLabel(
  email: string | undefined | null,
): Promise<string | null> {
  return (await lookupAuthor(email))?.label ?? null;
}

/**
 * Look up an email in the announcement author list. Returns the full author
 * entry (label + admin-curated name), or null if the email isn't authorized.
 */
export async function lookupAuthor(
  email: string | undefined | null,
): Promise<AnnouncementAuthor | null> {
  if (!email) return null;
  const lower = email.toLowerCase();
  const authors = await getAnnouncementAuthors();
  for (const a of authors) {
    if (a.email.toLowerCase() === lower) return a;
  }
  return null;
}

// --- Comment identity mode ---

/**
 * Hub-wide identity policy for community comments:
 *   real_name          — every comment carries the author's real name
 *   anonymous_optional — real name by default, resident may opt into
 *                        anonymity per comment (launch default)
 *   anonymous_only     — all comments are anonymous
 *
 * Votes are always ballot-secret and process creation is always
 * real-name — those are structural, not settings. This key only
 * governs comments.
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

export async function getCommentIdentityMode(): Promise<CommentIdentityMode> {
  const stored = await getSetting(SETTING_KEYS.COMMENT_IDENTITY_MODE);
  if (stored && (COMMENT_IDENTITY_MODES as string[]).includes(stored)) {
    return stored as CommentIdentityMode;
  }
  return DEFAULT_COMMENT_IDENTITY_MODE;
}

export async function setCommentIdentityMode(
  mode: string,
  updatedBy: string | null,
): Promise<CommentIdentityMode> {
  if (!(COMMENT_IDENTITY_MODES as string[]).includes(mode)) {
    throw new Error(
      `Invalid comment identity mode "${mode}". Valid: ${COMMENT_IDENTITY_MODES.join(", ")}`,
    );
  }
  await setSetting(SETTING_KEYS.COMMENT_IDENTITY_MODE, mode, updatedBy);
  return mode as CommentIdentityMode;
}

// --- Support threshold ---

const HARDCODED_DEFAULT_THRESHOLD = 5;

export async function getSupportThreshold(): Promise<number> {
  const stored = await getSetting(SETTING_KEYS.SUPPORT_THRESHOLD);
  if (stored !== null) {
    const n = parseInt(stored, 10);
    if (!Number.isNaN(n) && n >= 1) return n;
  }
  return HARDCODED_DEFAULT_THRESHOLD;
}

export async function setSupportThreshold(
  value: number,
  updatedBy: string | null,
): Promise<number> {
  const clamped = Math.max(1, Math.round(value));
  await setSetting(SETTING_KEYS.SUPPORT_THRESHOLD, String(clamped), updatedBy);
  return clamped;
}
