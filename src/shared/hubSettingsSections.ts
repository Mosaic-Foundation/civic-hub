// What a hub admin may edit from the Settings page, section by section.
//
// Contract: BUILD-PLAN-multi-tenant.md → Phase 4 → "Hub admin edits in the
// UI". That table and this file say the same thing; change both or neither.
//
// Shared by the server (which validates every write against it and refuses a
// key that is not here) and the admin UI (which renders one form per section
// and saves only that section's keys). It holds key names, kinds and limits —
// never copy: labels and hints belong to the page.
//
// NOT here, deliberately:
//   - people.admin_emails / people.board_emails — they decide who can edit
//     this list, so they have their own endpoint and a step-up code
//     (POST /admin/hub/people).
//   - hubs.mode — a column, not a setting, with its own step-up
//     (POST /admin/hub/mode).
//   - officials, brief recipients, the beta allowlist, the endorsement
//     threshold and the comment identity mode — older sections with their own
//     shaped writes on PATCH /admin/settings, kept as they are.
//   - email.from_address — the sending address belongs to the platform, not
//     to a hub (see "The sending domain belongs to the platform" in the build
//     plan). The Email section shows it read-only.

export type SettingFieldKind =
  /** One line of plain text. */
  | "text"
  /** A few lines of plain text. */
  | "textarea"
  /** Markdown, rendered on the public site. */
  | "markdown"
  /** A whole page of markdown with a shared template behind it (or none). */
  | "document"
  /** An uploaded image's URL. */
  | "image"
  | "email"
  | "boolean"
  /** An hour of the day, 0–23, in the hub's identity.timezone (UTC when unset). */
  | "hour"
  /** An IANA time zone name, e.g. "America/New_York"; empty means UTC. */
  | "timezone"
  /** An http(s) URL, or empty. */
  | "url"
  /** One of the spec's `options`, or empty when the spec allows it. */
  | "choice"
  /** A calendar date, YYYY-MM-DD, or empty. */
  | "date"
  /** A whole number within the spec's `min`–`max`, or empty. */
  | "number"
  /** #rrggbb. */
  | "color"
  /** A theme object (src/shared/theme.ts), stored as canonical JSON. */
  | "theme";

export interface SettingFieldSpec {
  key: string;
  kind: SettingFieldKind;
  /** Characters, after trimming. Unset means the kind's default. */
  maxLength?: number;
  /** "choice": the values allowed. Ids, not copy. */
  options?: readonly string[];
  /** "number": inclusive bounds. */
  min?: number;
  max?: number;
}

export const SETTINGS_SECTION_IDS = ["identity", "copy", "legal", "email", "theme", "plugins"] as const;

/**
 * Every plugin id, in the order the Plugins section lists them. The same ids
 * as PLUGIN_IDS in src/models/hubSettings.ts (tests/unit/pluginGate.test.ts
 * holds them equal); repeated here because this file is shared with the UI
 * and imports nothing from the server.
 */
export const PLUGIN_SECTION_ORDER = [
  "vote",
  "proposal",
  "project",
  "conversation",
  "wordcloud",
  "brief",
  "announcement",
  "meeting_summary",
  "news_sync",
  "assistant",
  "search",
  "feedback",
  "digest",
  "admin_digest",
] as const;

/** Meeting-summary connector ids (src/modules/civic.meeting_summary/connectors). */
export const MEETING_CONNECTOR_OPTIONS = ["auto", "wix-cms", "minutes-page", "youtube-channel"] as const;
/** News-sync connector ids (src/modules/civic.news_sync/connectors). */
export const NEWS_CONNECTOR_OPTIONS = ["wix-cms"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const SETTINGS_SECTIONS: Readonly<
  Record<SettingsSectionId, readonly SettingFieldSpec[]>
> = {
  identity: [
    { key: "identity.name", kind: "text", maxLength: 80 },
    { key: "identity.label", kind: "text", maxLength: 40 },
    { key: "identity.tagline", kind: "textarea", maxLength: 300 },
    { key: "identity.page_title", kind: "text", maxLength: 80 },
    { key: "identity.description", kind: "textarea", maxLength: 300 },
    { key: "identity.banner_url", kind: "image" },
    { key: "identity.banner_alt", kind: "text", maxLength: 200 },
    { key: "identity.logo_url", kind: "image" },
    { key: "identity.timezone", kind: "timezone" },
  ],
  copy: [
    // Both render as plain text (the welcome popup, the sign-up gate).
    { key: "copy.intro_body", kind: "textarea", maxLength: 1000 },
    { key: "copy.residency_intro", kind: "textarea", maxLength: 600 },
    { key: "copy.welcome", kind: "document" },
    { key: "copy.about", kind: "document" },
    { key: "copy.resident_noun", kind: "text", maxLength: 40 },
    { key: "copy.governing_body_name", kind: "text", maxLength: 80 },
    { key: "copy.governing_body_short", kind: "text", maxLength: 40 },
  ],
  legal: [
    { key: "legal.terms", kind: "document" },
    { key: "legal.privacy", kind: "document" },
    { key: "legal.code_of_conduct", kind: "document" },
    { key: "legal.proposal_best_practices", kind: "document" },
    { key: "legal.operator_name", kind: "text", maxLength: 120 },
    { key: "legal.contact_email", kind: "email" },
    { key: "legal.who_runs_this", kind: "markdown", maxLength: 3000 },
  ],
  email: [
    { key: "email.from_name", kind: "text", maxLength: 80 },
    { key: "email.postal_address", kind: "textarea", maxLength: 300 },
  ],
  // Its own section since 2026-09-24: a theme is a palette, not one colour.
  theme: [{ key: "identity.theme", kind: "theme" }],
  // Since Phase 2c (Adam, 2026-09-24): every plugin's on/off, and beneath it
  // the settings that plugin has. Settings another section already owns
  // (announcement authors, brief recipients, the support threshold, comment
  // anonymity) are linked from here, never repeated: one writer per key.
  plugins: [
    ...PLUGIN_SECTION_ORDER.map((id) => ({ key: `plugin.${id}.enabled`, kind: "boolean" as const })),
    { key: "plugin.vote.min_duration_days", kind: "number", min: 1, max: 365 },
    { key: "plugin.vote.max_duration_days", kind: "number", min: 1, max: 365 },
    { key: "plugin.vote.default_duration_days", kind: "number", min: 1, max: 365 },
    { key: "plugin.conversation.polis_url", kind: "url" },
    { key: "plugin.meeting_summary.connector_id", kind: "choice", options: MEETING_CONNECTOR_OPTIONS },
    { key: "plugin.meeting_summary.source_url", kind: "url" },
    { key: "plugin.meeting_summary.youtube_channel_id", kind: "text", maxLength: 64 },
    { key: "plugin.meeting_summary.title_filter", kind: "text", maxLength: 300 },
    { key: "plugin.meeting_summary.type_exclude", kind: "text", maxLength: 300 },
    { key: "plugin.meeting_summary.cutoff_date", kind: "date" },
    { key: "plugin.meeting_summary.auto_publish", kind: "boolean" },
    { key: "plugin.meeting_summary.extraction_instructions", kind: "textarea", maxLength: 4000 },
    { key: "plugin.news_sync.connector", kind: "choice", options: NEWS_CONNECTOR_OPTIONS },
    { key: "plugin.news_sync.source_url", kind: "url" },
    { key: "plugin.digest.send_hour", kind: "hour" },
  ],
};

/** A document is a page; 100 KB is several times the longest one today. */
export const DOCUMENT_MAX_LENGTH = 100_000;

/** Longest single-line value when a spec sets no limit. */
export const DEFAULT_TEXT_MAX_LENGTH = 200;

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
  );
}

/** Every key the settings endpoint accepts, in section order. */
export const EDITABLE_SETTING_KEYS: readonly string[] = SETTINGS_SECTION_IDS.flatMap(
  (id) => SETTINGS_SECTIONS[id].map((f) => f.key),
);

export function fieldSpec(key: string): SettingFieldSpec | undefined {
  for (const id of SETTINGS_SECTION_IDS) {
    const found = SETTINGS_SECTIONS[id].find((f) => f.key === key);
    if (found) return found;
  }
  return undefined;
}

/**
 * The placeholders a document may use, filled in per hub when it renders.
 * Shown beside every document editor so an admin can write "{HUB_NAME}"
 * instead of a name a rename would strand. Must match
 * `substitutions()` in src/services/hubDocuments.ts.
 */
export const DOCUMENT_PLACEHOLDERS: readonly string[] = [
  "{HUB_NAME}",
  "{HOSTNAME}",
  "{OPERATOR_NAME}",
  "{CONTACT_EMAIL}",
  "{PLACE}",
  "{STATE}",
  "{GOVERNING_BODY}",
];
