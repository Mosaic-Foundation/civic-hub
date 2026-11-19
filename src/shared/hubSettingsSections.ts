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

import type { PluginSetupRule } from "./pluginSetup.js";
import { MANIFEST_LIST, type ProcessPluginId } from "./processManifests.js";
import { HUB_FEATURES, type HubFeatureId } from "./hubFeatures.js";


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
  /** Which Wix collection columns hold what (Meeting summaries' wixFields.ts checks it, kernel step 3), or empty. */
  | "wix_fields"
  /** #rrggbb. */
  | "color"
  /** A theme object (src/shared/theme.ts), stored as canonical JSON. */
  | "theme"
  /**
   * One of this hub's processes of the spec's `processType`, by id, or empty
   * (2026-10-06: the word cloud the banner shows). The server checks that the
   * process exists on this hub and is of that type.
   */
  | "process"
  /**
   * The order of the hub's navigation sections (navigation slice,
   * 2026-10-14): a JSON array of distinct section ids. Feed is fixed first
   * and never listed. Switching a plugin off takes its section out
   * (hubSettingsController), so it comes back at the end; any other id the
   * hub doesn't have is skipped when the order is drawn.
   */
  | "section_order"
  /**
   * The right column's cards (layout session, 2026-11-07; ADR-019): a JSON
   * array of { id, shown } in order, ids distinct (src/shared/asideCards.ts).
   * Ids the hub doesn't draw are kept, so a plugin's card keeps its place.
   */
  | "aside_cards"
  /**
   * The hub's districts (districts and demographics, 2026-11-16): a JSON
   * array of { id, name }, ids distinct and kept when a name changes, so a
   * ballot tagged with a district keeps it (src/shared/aboutYou.ts).
   */
  | "district_list";

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
  /** "process": the process type the value must name, e.g. "civic.wordcloud". */
  processType?: string;
  /**
   * A plugin setting's "?" note, written into src/shared/helpRegistry.json
   * under its key by `npm run plugins:sync` (kernel step 4), so the note
   * comes from the plugin's own folder.
   */
  help?: { text: string; page: string; anchor: string; pending?: boolean };
}

export const SETTINGS_SECTION_IDS = ["identity", "copy", "legal", "email", "theme", "districts", "plugins"] as const;

/** A `plugin.<id>.` id: a process plugin (from the manifests) or a hub feature. */
export type PluginId = ProcessPluginId | HubFeatureId;

/**
 * Each plugin's part of the Plugins section, in its order: every process
 * plugin's (its manifest's pluginSection) and every hub feature's
 * (src/shared/hubFeatures.ts), on one scale (ADR-009).
 */
export interface PluginSectionInfo {
  id: PluginId;
  order: number;
  /** What the Plugins page calls it: "Votes". */
  name: string;
  /** Its one line on the Plugins page. */
  what: string;
  fields: readonly SettingFieldSpec[];
  /** Its own settings-search words, by key (a manifest's pluginSection.search). */
  search?: Readonly<Record<string, { label: string; words?: readonly string[] }>>;
  /** Other words an admin might type for its panel (a manifest's pluginSection.words). */
  words?: readonly string[];
  /** When it is on but cannot work yet ("needs setup"; a manifest's pluginSection.setup). */
  setup?: PluginSetupRule;
}

const PLUGIN_SECTIONS: readonly PluginSectionInfo[] = [
  ...MANIFEST_LIST.flatMap((m) =>
    m.pluginSection
      ? [
          {
            id: m.descriptor.plugin as ProcessPluginId,
            order: m.pluginSection.order,
            name: m.pluginSection.name,
            what: m.pluginSection.what,
            fields: m.pluginSection.fields,
            search: m.pluginSection.search,
            words: m.pluginSection.words,
            setup: m.pluginSection.setup,
          },
        ]
      : [],
  ),
  ...HUB_FEATURES,
].sort((x, y) => x.order - y.order);

/** Every plugin's part of the Plugins section, in its order (the settings search reads it). */
export const PLUGIN_SECTION_INFO: readonly PluginSectionInfo[] = PLUGIN_SECTIONS;

/** Every plugin id, in the order the Plugins section lists them (and PLUGIN_IDS is). */
export const PLUGIN_SECTION_ORDER: readonly PluginId[] = PLUGIN_SECTIONS.map((p) => p.id);

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
    { key: "copy.welcome_strip", kind: "textarea", maxLength: 400 },
    { key: "copy.welcome_strip_hidden", kind: "boolean" },
    { key: "copy.beta_banner", kind: "textarea", maxLength: 300 },
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
    { key: "legal.governing_state", kind: "text", maxLength: 60 },
    { key: "legal.who_runs_this", kind: "markdown", maxLength: 3000 },
    { key: "legal.reviewed", kind: "boolean" },
  ],
  email: [
    { key: "email.from_name", kind: "text", maxLength: 80 },
    { key: "email.postal_address", kind: "textarea", maxLength: 300 },
  ],
  // Its own section since 2026-09-24: a theme is a palette, not one colour.
  // Navigation joined it on 2026-10-14 (Adam): where the sections are drawn,
  // and their one order. The right column's cards joined it on 2026-11-07.
  theme: [
    { key: "identity.theme", kind: "theme" },
    // Stored values kept when the choices were relabelled Left column, Top
    // navigation and Three columns (Adam, 2026-11-07).
    { key: "nav.layout", kind: "choice", options: ["sidebar", "top_tabs", "three_columns"] },
    { key: "nav.section_order", kind: "section_order" },
    { key: "nav.aside_cards", kind: "aside_cards" },
    // The feed's closing reminders (Events 4): hours before a close, up to 14 days; 0 is off.
    { key: "feed.closing_reminder_hours", kind: "number", min: 0, max: 336 },
  ],
  // Districts and demographics (Adam, 2026-11-16): what a district is
  // called, the list, where to look one up, and which About-you questions
  // members are asked (src/shared/aboutYou.ts).
  districts: [
    { key: "about.district_term", kind: "text", maxLength: 40 },
    { key: "about.district_term_plural", kind: "text", maxLength: 40 },
    { key: "about.districts", kind: "district_list" },
    { key: "about.ask_district", kind: "boolean" },
    { key: "about.ask_birth_year", kind: "boolean" },
    { key: "about.ask_race", kind: "boolean" },
  ],
  // Since Phase 2c (Adam, 2026-09-24): every plugin's on/off, and beneath it
  // the settings that plugin has. Settings another section already owns
  // (announcement authors, brief recipients, the support threshold, comment
  // anonymity) are linked from here, never repeated: one writer per key.
  plugins: [
    ...PLUGIN_SECTION_ORDER.map((id) => ({ key: `plugin.${id}.enabled`, kind: "boolean" as const })),
    // Then each plugin's own settings, in the same order. Settings another
    // section owns (announcement authors, brief recipients, the support
    // threshold, comment anonymity) are linked from the page, never repeated.
    ...PLUGIN_SECTIONS.flatMap((p) => p.fields),
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
