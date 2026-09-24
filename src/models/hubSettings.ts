// Hub settings — the key names, the alias map, the env fallbacks, and what
// may be public.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings". The
// two tables in that document are the two tables below: do not add a key here
// without adding it there.
//
// Pure by construction — no database, no request — so CI can test the rules
// that decide what a hub is allowed to expose.

/**
 * Every canonical key. Dotted, lowercase, namespaced.
 *
 * Plugin keys use `plugin.<id>.<setting>` where <id> is the process registry
 * id. Only the ones a hub actually configures are listed; a plugin's
 * `enabled` flag is always `plugin.<id>.enabled`.
 */
export const KEYS = {
  IDENTITY_NAME: "identity.name",
  IDENTITY_LABEL: "identity.label",
  IDENTITY_TAGLINE: "identity.tagline",
  IDENTITY_PAGE_TITLE: "identity.page_title",
  IDENTITY_DESCRIPTION: "identity.description",
  IDENTITY_BANNER_URL: "identity.banner_url",
  IDENTITY_BANNER_ALT: "identity.banner_alt",
  IDENTITY_THEME: "identity.theme",
  // Added 2026-09-24 (Adam, Phase 1 part five): an uploaded image shown in
  // the header beside the hub's name. Public, because the header renders it
  // for every visitor — the one key that session added to the public list.
  IDENTITY_LOGO_URL: "identity.logo_url",

  COPY_INTRO_BODY: "copy.intro_body",
  COPY_RESIDENCY_INTRO: "copy.residency_intro",
  COPY_WELCOME: "copy.welcome",
  COPY_ABOUT: "copy.about",
  COPY_RESIDENT_NOUN: "copy.resident_noun",
  COPY_GOVERNING_BODY_NAME: "copy.governing_body_name",
  COPY_GOVERNING_BODY_SHORT: "copy.governing_body_short",

  LEGAL_TERMS: "legal.terms",
  LEGAL_PRIVACY: "legal.privacy",
  LEGAL_CODE_OF_CONDUCT: "legal.code_of_conduct",
  LEGAL_PROPOSAL_BEST_PRACTICES: "legal.proposal_best_practices",

  // Who is answerable for this hub, and where to reach them. Added
  // 2026-09-23 after Athens served Floyd's operator and Floyd's address on
  // its own legal pages. They are short strings, not documents: the four
  // documents above substitute them in, so a hub states each once.
  //
  // `legal.operator_name` is free text because an operator is not always a
  // person — "Athens Moderator Group", "the Town of X", a named individual.
  LEGAL_OPERATOR_NAME: "legal.operator_name",
  LEGAL_CONTACT_EMAIL: "legal.contact_email",

  // The whole "who runs this site" paragraph, not just the name in it.
  //
  // Added 2026-09-23 (Adam). Substituting an operator's name into a fixed
  // sentence is not enough, because the sentence itself is only true of some
  // operators: the shared default says "we are not affiliated with or
  // operated by the {PLACE} government", which is exactly backwards for a hub
  // a town council runs itself. Who runs a hub, and what their relationship
  // to local government is, is a statement only that hub can make.
  //
  // A hub that sets nothing gets the default in config/legal/who-runs-this.md
  // with its own names substituted, so this changes nothing until it is used.
  LEGAL_WHO_RUNS_THIS: "legal.who_runs_this",

  PEOPLE_ADMIN_EMAILS: "people.admin_emails",
  PEOPLE_BOARD_EMAILS: "people.board_emails",
  PEOPLE_BRIEF_RECIPIENTS: "people.brief_recipients",
  PEOPLE_ANNOUNCEMENT_AUTHORS: "people.announcement_authors",
  PEOPLE_OFFICIALS_MIGRATED: "people.officials_migrated",

  EMAIL_FROM_NAME: "email.from_name",
  EMAIL_FROM_ADDRESS: "email.from_address",
  EMAIL_POSTAL_ADDRESS: "email.postal_address",

  BETA_ALLOWLIST: "beta.allowlist",
  BETA_WAITLIST_ENABLED: "beta.waitlist_enabled",
  // NOTE: there is no beta.enabled, beta.demo_mode or beta.demo_bypass_code.
  // Those were two booleans that could contradict each other; a hub's
  // lifecycle is now the single `hubs.mode` column (demo | beta | live).
  // See src/models/hub.ts.

  MODERATION_COMMENT_IDENTITY_MODE: "moderation.comment_identity_mode",

  PLUGIN_VOTE_SUPPORT_THRESHOLD: "plugin.vote.support_threshold",
  PLUGIN_CONVERSATION_POLIS_URL: "plugin.conversation.polis_url",
  PLUGIN_WORDCLOUD_ONBOARDING_ID: "plugin.wordcloud.onboarding_id",
  PLUGIN_FEEDBACK_RECIPIENTS: "plugin.feedback.recipients",

  PLUGIN_DIGEST_ENABLED: "plugin.digest.enabled",
  PLUGIN_ADMIN_DIGEST_ENABLED: "plugin.admin_digest.enabled",
  // The hour of the day, 0–23 in UTC, the resident digest goes out. Added
  // 2026-09-24 (Adam). STORED ONLY until Phase 2: the digest cron runs once
  // a day with no hub in scope, and `users` has no hub_id, so running it per
  // hub would mail every user on the shared table once per hub. Phase 2 makes
  // the cron hourly and per hub, and this is what it reads.
  PLUGIN_DIGEST_SEND_HOUR: "plugin.digest.send_hour",

  PLUGIN_MEETING_SOURCE_URL: "plugin.meeting_summary.source_url",
  PLUGIN_MEETING_CONNECTOR_ID: "plugin.meeting_summary.connector_id",
  PLUGIN_MEETING_EXTRACTION_INSTRUCTIONS:
    "plugin.meeting_summary.extraction_instructions",
  PLUGIN_MEETING_TITLE_FILTER: "plugin.meeting_summary.title_filter",
  PLUGIN_MEETING_TYPE_EXCLUDE: "plugin.meeting_summary.type_exclude",
  PLUGIN_MEETING_WIX_COLLECTION: "plugin.meeting_summary.wix_collection",
  PLUGIN_MEETING_YOUTUBE_CHANNEL_ID:
    "plugin.meeting_summary.youtube_channel_id",
  PLUGIN_MEETING_AUTO_PUBLISH: "plugin.meeting_summary.auto_publish",
  PLUGIN_MEETING_CUTOFF_DATE: "plugin.meeting_summary.cutoff_date",
  PLUGIN_MEETING_MAX_PER_RUN: "plugin.meeting_summary.max_per_run",

  // Which connector reads the hub's news feed ("wix-cms"), chosen per hub.
  // Added 2026-09-24 with the module rename; it has no env fallback because
  // it never had an env var — the one connector was the only code path.
  PLUGIN_NEWS_SYNC_CONNECTOR: "plugin.news_sync.connector",
  PLUGIN_NEWS_SYNC_SOURCE_URL: "plugin.news_sync.source_url",
  PLUGIN_NEWS_SYNC_MAX_PER_RUN: "plugin.news_sync.max_per_run",
} as const;

export type SettingKey = (typeof KEYS)[keyof typeof KEYS] | string;

/** The process registry ids a hub can carry `plugin.<id>.*` settings for. */
export const PLUGIN_IDS = [
  "vote",
  "proposal",
  "project",
  "announcement",
  "brief",
  "meeting_summary",
  "wordcloud",
  "conversation",
  "assistant",
  "digest",
  "admin_digest",
  "search",
  "feedback",
  "news_sync",
] as const;

/**
 * Legacy key names that still resolve. A read tries the canonical key first,
 * then the alias. Writes always go to the canonical key.
 *
 * These are rows that already exist in production, written before the dotted
 * scheme. They keep working until the Phase 4 migration copies them across;
 * an entry leaves this map only after the cutover.
 */
export const KEY_ALIASES: Readonly<Record<string, string>> = {
  [KEYS.PEOPLE_BRIEF_RECIPIENTS]: "brief_recipient_emails",
  [KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS]: "announcement_authors",
  [KEYS.PEOPLE_OFFICIALS_MIGRATED]: "officials_migrated",
  [KEYS.BETA_ALLOWLIST]: "beta_allowlist",
  [KEYS.MODERATION_COMMENT_IDENTITY_MODE]: "comment_identity_mode",
  [KEYS.PLUGIN_VOTE_SUPPORT_THRESHOLD]: "support_threshold",
};

/**
 * Environment variables a key falls back to when no row exists, in order.
 *
 * This is the bridge, not the destination: it keeps a deployment that has not
 * been seeded working exactly as it did, and it is what makes a single-hub
 * self-host with no settings rows a supported configuration rather than an
 * accident. A key with no entry here has no env fallback at all.
 */
export const ENV_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  [KEYS.IDENTITY_NAME]: ["HUB_NAME", "VITE_HUB_NAME"],
  [KEYS.IDENTITY_LABEL]: ["VITE_HUB_LABEL"],
  [KEYS.IDENTITY_TAGLINE]: ["VITE_HUB_TAGLINE"],
  [KEYS.IDENTITY_PAGE_TITLE]: ["VITE_HUB_PAGE_TITLE"],
  [KEYS.IDENTITY_DESCRIPTION]: ["VITE_HUB_DESCRIPTION"],
  [KEYS.IDENTITY_BANNER_URL]: ["VITE_HUB_BANNER_URL"],
  [KEYS.IDENTITY_BANNER_ALT]: ["VITE_HUB_BANNER_ALT"],
  [KEYS.IDENTITY_THEME]: ["VITE_HUB_THEME"],

  [KEYS.COPY_INTRO_BODY]: ["VITE_HUB_INTRO_BODY"],
  [KEYS.COPY_RESIDENCY_INTRO]: ["VITE_HUB_RESIDENCY_INTRO"],
  [KEYS.COPY_GOVERNING_BODY_NAME]: ["VITE_HUB_GOVERNING_BODY_NAME"],
  [KEYS.COPY_GOVERNING_BODY_SHORT]: ["VITE_HUB_GOVERNING_BODY_SHORT"],

  [KEYS.PEOPLE_ADMIN_EMAILS]: ["CIVIC_ADMIN_EMAILS"],
  [KEYS.PEOPLE_BOARD_EMAILS]: ["CIVIC_BOARD_EMAILS"],
  [KEYS.PEOPLE_BRIEF_RECIPIENTS]: ["BOARD_RECIPIENT_EMAIL"],

  [KEYS.EMAIL_FROM_ADDRESS]: ["RESEND_FROM", "SMTP_FROM"],
  [KEYS.EMAIL_POSTAL_ADDRESS]: ["HUB_POSTAL_ADDRESS"],

  [KEYS.PLUGIN_CONVERSATION_POLIS_URL]: ["VITE_HUB_POLIS_URL", "POLIS_BASE_URL"],
  [KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID]: ["VITE_HUB_ONBOARDING_WORDCLOUD_ID"],
  [KEYS.PLUGIN_FEEDBACK_RECIPIENTS]: ["FEEDBACK_RECIPIENT_EMAIL"],

  [KEYS.PLUGIN_MEETING_SOURCE_URL]: ["MEETING_SOURCE_URL"],
  [KEYS.PLUGIN_MEETING_CONNECTOR_ID]: ["MEETING_CONNECTOR_ID"],
  [KEYS.PLUGIN_MEETING_EXTRACTION_INSTRUCTIONS]: ["MEETING_EXTRACTION_INSTRUCTIONS"],
  [KEYS.PLUGIN_MEETING_TITLE_FILTER]: ["MEETING_TITLE_FILTER"],
  [KEYS.PLUGIN_MEETING_TYPE_EXCLUDE]: ["MEETING_TYPE_EXCLUDE"],
  [KEYS.PLUGIN_MEETING_WIX_COLLECTION]: ["MEETING_WIX_COLLECTION"],
  [KEYS.PLUGIN_MEETING_YOUTUBE_CHANNEL_ID]: ["MEETING_YOUTUBE_CHANNEL_ID"],
  [KEYS.PLUGIN_MEETING_AUTO_PUBLISH]: ["MEETING_SUMMARY_AUTO_PUBLISH"],
  [KEYS.PLUGIN_MEETING_CUTOFF_DATE]: ["MEETING_SUMMARY_CUTOFF_DATE"],
  [KEYS.PLUGIN_MEETING_MAX_PER_RUN]: ["MEETING_SUMMARY_MAX_PER_RUN"],

  [KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL]: ["FLOYD_NEWS_SOURCE_URL"],
  [KEYS.PLUGIN_NEWS_SYNC_MAX_PER_RUN]: ["FLOYD_NEWS_SYNC_MAX_PER_RUN"],

  [KEYS.PLUGIN_DIGEST_ENABLED]: ["DIGEST_ENABLED"],
  [KEYS.PLUGIN_ADMIN_DIGEST_ENABLED]: ["ADMIN_DIGEST_ENABLED"],
  "plugin.meeting_summary.enabled": ["MEETING_SUMMARY_ENABLED"],
  "plugin.news_sync.enabled": ["FLOYD_NEWS_SYNC_ENABLED"],
};

/**
 * Keys that may be served to an unauthenticated client.
 *
 * A LIST OF KEYS, NOT OF NAMESPACES. A new key in a public namespace is
 * admin-only until it is named here, so adding a setting can never make
 * something public by accident. Everything absent — the beta allowlist, the
 * demo bypass code, every people.* and email.* key, every plugin setting
 * that is not `enabled` — is admin-only.
 */
/**
 * The public keys, in order, so a caller can resolve each one rather than
 * filtering a map — which matters because a value may come from the row, the
 * legacy alias or the env fallback, and only the service knows which.
 */
export const PUBLIC_KEY_LIST: readonly string[] = [
  KEYS.IDENTITY_NAME,
  KEYS.IDENTITY_LABEL,
  KEYS.IDENTITY_TAGLINE,
  KEYS.IDENTITY_PAGE_TITLE,
  KEYS.IDENTITY_DESCRIPTION,
  KEYS.IDENTITY_BANNER_URL,
  KEYS.IDENTITY_BANNER_ALT,
  KEYS.IDENTITY_THEME,
  KEYS.IDENTITY_LOGO_URL,

  KEYS.COPY_INTRO_BODY,
  KEYS.COPY_RESIDENCY_INTRO,
  KEYS.COPY_RESIDENT_NOUN,
  KEYS.COPY_GOVERNING_BODY_NAME,
  KEYS.COPY_GOVERNING_BODY_SHORT,

  KEYS.LEGAL_TERMS,
  KEYS.LEGAL_PRIVACY,
  KEYS.LEGAL_CODE_OF_CONDUCT,
  KEYS.LEGAL_PROPOSAL_BEST_PRACTICES,

  // Both are printed verbatim on the public legal pages, so serving them
  // discloses nothing the documents do not. The client needs them for the
  // places that name the operator outside a document — the welcome page
  // footer, the "who do I complain to" line.
  KEYS.LEGAL_OPERATOR_NAME,
  KEYS.LEGAL_CONTACT_EMAIL,
  KEYS.LEGAL_WHO_RUNS_THIS,

  KEYS.BETA_WAITLIST_ENABLED,

  KEYS.MODERATION_COMMENT_IDENTITY_MODE,

  // Confirmed with Adam 2026-09-22: both are rendered by the client — a URL
  // that becomes a link, and the id of a public process — and both already
  // shipped in the bundle as VITE_ variables.
  KEYS.PLUGIN_CONVERSATION_POLIS_URL,
  KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID,
];

const PUBLIC_KEYS: ReadonlySet<string> = new Set(PUBLIC_KEY_LIST);

/**
 * Keys whose values are whole documents rather than short configuration.
 *
 * These are deliberately kept OUT of the per-request settings snapshot. The
 * four legal documents plus the About page are around 30 KB of markdown
 * between them, and almost no request needs any of them: pulling that into
 * memory to answer "is this person an admin" would make every request pay for
 * a page that is read occasionally. They are loaded on demand instead, with
 * their own cache, and served by their own endpoint.
 *
 * A key belongs here when its value is prose measured in kilobytes. A short
 * string, however wordy, does not — `copy.intro_body` is a sentence and stays
 * in the snapshot.
 */
export const DOCUMENT_KEYS: readonly string[] = [
  KEYS.LEGAL_TERMS,
  KEYS.LEGAL_PRIVACY,
  KEYS.LEGAL_CODE_OF_CONDUCT,
  KEYS.LEGAL_PROPOSAL_BEST_PRACTICES,
  KEYS.COPY_ABOUT,
  // The welcome essay, 9 KB of it, joined the documents on 2026-09-23. It
  // used to be compiled into the UI bundle from a file — which is how Athens
  // came to serve a personal introduction to another county.
  KEYS.COPY_WELCOME,
];

export function isDocumentKey(key: string): boolean {
  return DOCUMENT_KEYS.includes(key);
}

/** Is this key safe to serve to anyone? `plugin.<id>.enabled` always is. */
export function isPublicKey(key: string): boolean {
  if (PUBLIC_KEYS.has(key)) return true;
  return /^plugin\.[a-z_]+\.enabled$/.test(key);
}

/** Keep only the public keys of a settings map. */
export function publicSubset(
  all: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (isPublicKey(key) && value !== "") out[key] = value;
  }
  return out;
}

// --- value encoding -------------------------------------------------------
//
// The build plan fixes the encoding: strings as-is, lists as JSON arrays,
// booleans as "true"/"false", numbers as decimal strings. These are the only
// place that knows it, so no caller ever parses a raw value.

export function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

export function asNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * A stored list. Accepts a JSON array (the encoding) or a comma-separated
 * string (what the legacy rows and every env var still hold), so an alias row
 * and its replacement read the same.
 */
export function asList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v) => v.length > 0);
      }
    } catch {
      // Fall through — a corrupt row reads as a comma list rather than
      // throwing, because an unreadable setting must not take down the page
      // that happens to need it.
    }
  }
  return trimmed
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Lowercased, deduped, order preserved — for email lists. */
export function asEmailList(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of asList(value)) {
    const lower = entry.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

export function encodeList(values: readonly string[]): string {
  return JSON.stringify(values);
}
