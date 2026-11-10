// The search box on Hub settings (settings search, 2026-11-10): type what
// you're looking for ("wait list", "logo", "turn off votes") and go straight
// to the setting, its panel opened and the field marked.
//
// It cannot go stale, because it is built from the help registry
// (src/shared/helpRegistry.json), which every setting, section, part and
// plugin panel must already join (tests/unit/helpRegistry.test.ts). Here each
// of those keys gets:
//   - a label (the words the page shows), unless the hub already knows it:
//     a section's comes from SETTINGS_NAV, a plugin panel's from its plugin;
//   - other words an admin might type for it (synonyms, old names, plain
//     descriptions), optional;
//   - its place, worked out from the key (pathForKey), never written by hand.
// tests/unit/settingsSearch.test.ts fails when a help key has no entry here
// (or in NOT_IN_SEARCH, with a reason), and when an entry names no help key.
// tests/e2e/settingsSearch.spec.ts opens every entry's link and finds the
// setting on the page.
//
// A plugin package can carry its own entries in its manifest
// (pluginSection.search); one there wins over this list.
//
// The link: /admin/settings/<section>#<anchorForKey(key)>. Every "?" button
// (HelpButton) carries that anchor, so the page scrolls to the setting's own
// "?" and marks its field. A plugin's panel opens for its own keys' anchors.
//
// Shared with the UI: pure, imports nothing from the server.

import { HELP, anchorForKey } from "./helpRegistry.js";
import { SETTINGS_NAV, isSettingsNavId, type SettingsNavId } from "./adminAnchors.js";
import { PLUGIN_SECTION_INFO, SETTINGS_SECTIONS, SETTINGS_SECTION_IDS } from "./hubSettingsSections.js";

export interface SearchWords {
  /** What the page calls it. Required except for sections and plugin panels. */
  label?: string;
  /** Other words an admin might type for it. */
  words?: readonly string[];
}

/** Help keys that are not a hub setting, so not in the search, and why. */
export const NOT_IN_SEARCH: Readonly<Record<string, string>> = {
  "admin.setup_guide": "a link to the docs' setup guide, not a setting (Getting started is in the search)",
  "admin.feedback_forward": "a button on a feedback item in Admin → Feedback",
  "admin.contact_civic_social": "a page for writing to Civic.Social, not a setting",
  "share.invites": "the Share this hub panel's invites, which every member has",
  "members.visibility": "each person's own choice, in their own settings",
};

/**
 * Parts that are on the page only sometimes; their link opens the section
 * (or the plugin's panel) when the part is not there. The E2E check allows it.
 */
export const SOMETIMES_SHOWN: Readonly<Record<string, string>> = {
  "people.board": "only while the hub still has an old board list",
  "people.hidden_members": "only while the Members plugin is on",
  "plugins.install": "only on a plugin that is installed rather than switched on",
  "plugins.remove": "only on a plugin that is installed rather than switched on",
  "plugins.update": "only when a newer version of an installed plugin is waiting",
  "mode.readiness": "only after choosing a mode to switch to",
  "mode.switch": "only after choosing a mode to switch to",
  "nav.aside_cards": "only with the Three columns layout",
};

/** Words for a plugin's switch; every plugin panel gets them. */
const SWITCH_WORDS = ["turn on", "turn off", "switch on", "switch off", "enable", "disable", "hide", "plugin"];

/**
 * The hub's list, by help key. Labels are the page's own; words are what an
 * admin might type instead. Keep words lower-case and plain.
 */
export const SEARCH_WORDS: Readonly<Record<string, SearchWords>> = {
  // Sections (labels from SETTINGS_NAV).
  "settings.getting-started": { words: ["setup", "set up", "checklist", "onboarding", "first steps", "start"] },
  "settings.identity": { words: ["name", "brand", "branding", "header", "logo", "banner"] },
  "settings.theme": {
    words: ["theme", "colors", "colours", "look", "style", "branding", "navigation", "layout", "menu", "font"],
  },
  "settings.copy": { words: ["wording", "text", "words", "pages", "welcome", "about"] },
  "settings.legal": { words: ["terms", "privacy", "policies", "law", "documents", "agreement"] },
  "settings.email": { words: ["mail", "emails", "sender", "newsletter", "footer", "can spam"] },
  "settings.mode": {
    words: ["demo", "beta", "live", "launch", "go live", "open", "private", "public", "who can sign in", "waitlist", "allowlist", "access"],
  },
  "settings.sample": { words: ["example", "examples", "demo content", "placeholder", "fake", "seed", "remove samples"] },
  "settings.admin-log": { words: ["audit", "history", "log", "activity", "who changed", "record", "changes"] },
  "settings.people": { words: ["admins", "administrators", "people", "team", "staff", "moderators", "add admin", "remove admin"] },
  "settings.officials": {
    words: ["representatives", "board", "council", "elected", "politicians", "officers", "brief recipients", "legislators"],
  },
  "settings.participation": { words: ["endorsements", "threshold", "anonymous", "comments", "support"] },
  "settings.plugins": { words: ["features", "modules", "add-ons", "addons", "extensions", "apps", "turn on", "turn off"] },

  // Plugin panels (labels from each plugin).
  "plugins.vote": { words: ["voting", "ballot", "ballots", "poll", "polls", "advisory vote"] },
  "plugins.proposal": { words: ["proposals", "ideas", "suggestions", "petition", "petitions", "propose"] },
  "plugins.project": { words: ["projects", "initiatives", "volunteer"] },
  "plugins.events": { words: ["events", "calendar", "meetings", "happenings", "schedule"] },
  "plugins.conversation": { words: ["polis", "deliberation", "discussion", "conversations", "dialogue"] },
  "plugins.wordcloud": { words: ["word cloud", "word clouds", "words", "onboarding question"] },
  "plugins.brief": { words: ["briefs", "report", "results", "officials", "summary of results"] },
  "plugins.announcement": { words: ["announcements", "news", "notices", "posts", "updates"] },
  "plugins.meeting_summary": { words: ["meetings", "minutes", "agendas", "council meetings", "ai summaries", "recordings"] },
  "plugins.news_sync": { words: ["rss", "news feed", "feed import", "import news", "atom"] },
  "plugins.assistant": { words: ["ai", "artificial intelligence", "writing help", "llm", "claude", "chatbot"] },
  "plugins.search": { words: ["search", "find", "full text"] },
  "plugins.feedback": { words: ["feedback", "contact", "bug reports", "report a problem", "suggestions"] },
  "plugins.digest": { words: ["digest", "newsletter", "summary email", "weekly email", "daily email"] },
  "plugins.admin_digest": { words: ["admin email", "daily email", "admin summary", "notifications"] },
  "plugins.members": { words: ["members", "member count", "faces", "avatars", "directory", "residents list"] },
  "plugins.analytics": { words: ["activity", "analytics", "statistics", "stats", "metrics", "numbers", "reporting", "participation counts"] },

  // Parts of sections.
  "participation.threshold": {
    label: "Proposal endorsement threshold",
    words: ["endorsements", "support needed", "signatures", "how many supporters", "minimum support", "threshold"],
  },
  "participation.anonymity": {
    label: "Comments & anonymity",
    words: ["anonymous", "anonymity", "comment names", "real names", "pseudonyms", "comments"],
  },
  "mode.allowlist": {
    label: "Beta allowlist",
    words: ["allow list", "whitelist", "white list", "invite list", "who can join", "beta testers", "access list"],
  },
  "mode.waitlist": {
    label: "Waitlist",
    words: ["wait list", "waiting list", "queue", "sign up requests", "pending members", "requests to join"],
  },
  "mode.readiness": { label: "Before you switch", words: ["ready", "readiness", "go live checklist", "launch checklist"] },
  "mode.switch": { label: "What happens when you switch", words: ["switch mode", "change mode", "go live", "launch"] },
  "people.admins": {
    label: "Admins",
    words: ["administrators", "add admin", "remove admin", "make admin", "co-admin", "second admin", "permissions"],
  },
  "people.board": { label: "Old board list", words: ["board members", "board emails"] },
  "people.hidden_members": { label: "Hidden members", words: ["hidden", "private members", "unlisted members"] },
  "officials.extra_recipients": {
    label: "Also send briefs to",
    words: ["brief recipients", "cc", "copy briefs", "extra recipients", "send results to"],
  },
  "plugins.install": { label: "Install a plugin", words: ["add plugin", "install"] },
  "plugins.remove": { label: "Remove a plugin", words: ["uninstall", "delete plugin", "remove"] },
  "plugins.update": { label: "Update a plugin", words: ["upgrade", "new version", "update"] },

  // Identity.
  "identity.name": { label: "Hub name", words: ["site name", "title", "rename", "name of the hub"] },
  "identity.label": { label: "Label", words: ["short name", "badge", "nickname"] },
  "identity.tagline": { label: "Tagline", words: ["slogan", "motto", "subtitle", "strapline"] },
  "identity.page_title": { label: "Page title", words: ["browser tab", "tab title", "seo title", "window title"] },
  "identity.description": { label: "Description", words: ["meta description", "share card", "seo", "link preview"] },
  "identity.banner_url": { label: "Banner", words: ["header image", "hero image", "cover photo", "banner image", "picture"] },
  "identity.logo_url": { label: "Logo", words: ["icon", "favicon", "emblem", "seal", "crest", "image"] },
  "identity.timezone": { label: "Time zone", words: ["timezone", "clock", "local time", "hours", "dst"] },

  // Copy & pages.
  "copy.intro_body": { label: "Intro", words: ["welcome popup", "first visit", "introduction", "popup"] },
  "copy.residency_intro": { label: "Residency intro", words: ["sign up gate", "residency", "who can join", "residents only", "address check"] },
  "copy.welcome": { label: "Welcome page", words: ["welcome", "landing page", "home page text"] },
  "copy.about": { label: "About page", words: ["about us", "about", "mission"] },
  "copy.welcome_strip": { label: "Welcome strip", words: ["welcome banner", "strip", "home page banner"] },
  "copy.welcome_strip_hidden": { label: "Hide the welcome strip", words: ["hide welcome", "remove welcome banner"] },
  "copy.beta_banner": { label: "Beta bar", words: ["beta banner", "test banner", "notice bar", "top bar"] },
  "copy.resident_noun": {
    label: "What participants are called",
    words: ["residents", "citizens", "members", "neighbors", "neighbours", "people", "participants"],
  },
  "copy.governing_body_name": {
    label: "Governing body",
    words: ["council", "city council", "town board", "commission", "government", "local government"],
  },
  "copy.governing_body_short": { label: "Board label", words: ["short name", "council", "board"] },

  // Legal.
  "legal.terms": { label: "Terms of Service", words: ["terms", "tos", "terms of use", "conditions"] },
  "legal.privacy": { label: "Privacy Policy", words: ["privacy", "data", "gdpr", "personal data"] },
  "legal.code_of_conduct": { label: "Code of Conduct", words: ["rules", "community guidelines", "behavior", "behaviour", "moderation rules"] },
  "legal.proposal_best_practices": { label: "Proposal guide", words: ["best practices", "how to propose", "proposal tips"] },
  "legal.operator_name": { label: "Operated by", words: ["operator", "owner", "organization", "organisation", "who runs"] },
  "legal.contact_email": { label: "Contact address", words: ["contact", "support email", "email address", "reply to"] },
  "legal.governing_state": { label: "Governing law (state)", words: ["state", "jurisdiction", "law"] },
  "legal.who_runs_this": { label: "Who runs this site", words: ["operator", "about the operator", "responsible"] },
  "legal.reviewed": {
    label: "Our Terms and Privacy Policy have been reviewed",
    words: ["lawyer", "legal review", "reviewed", "attorney"],
  },

  // Email.
  "email.from_name": { label: "From name", words: ["sender name", "sender", "from"] },
  "email.postal_address": { label: "Postal address", words: ["mailing address", "physical address", "can spam", "address", "footer"] },

  // Appearance.
  "identity.theme": {
    label: "Colours",
    words: ["colors", "theme", "palette", "preset", "brand colours", "brand colors", "dark mode", "background", "font", "typeface"],
  },
  "nav.layout": { label: "Navigation", words: ["layout", "menu", "sidebar", "tabs", "three columns", "top navigation", "left column"] },
  "nav.section_order": { label: "Section order", words: ["menu order", "reorder", "tabs order", "navigation order", "arrange"] },
  "nav.aside_cards": { label: "Right column", words: ["sidebar cards", "aside", "coming up", "widgets"] },
  "feed.closing_reminder_hours": {
    label: "Closing reminders in the feed",
    words: ["closing soon", "deadline", "reminder", "ending soon", "countdown"],
  },

  // Plugin settings (until each package carries its own pluginSection.search).
  "plugin.vote.min_duration_days": { label: "Shortest voting window", words: ["minimum vote length", "vote duration", "how long votes run"] },
  "plugin.vote.max_duration_days": { label: "Longest voting window", words: ["maximum vote length", "vote duration", "how long votes run"] },
  "plugin.vote.default_duration_days": { label: "Default voting window", words: ["vote length", "vote duration", "how long votes run"] },
  "plugin.vote.default_check_mode": { label: "Receipt check, for new votes", words: ["receipt", "ballot check", "verify vote", "show choice"] },
  "plugin.conversation.polis_url": { label: "Conversation server", words: ["polis", "polis server", "polis url"] },
  "plugin.wordcloud.onboarding_id": { label: "The hub's word cloud", words: ["onboarding question", "banner word cloud", "sign up question"] },
  "plugin.meeting_summary.connector_id": { label: "Where meetings come from", words: ["source", "connector", "wix", "youtube", "agenda site"] },
  "plugin.meeting_summary.source_url": { label: "Meetings page", words: ["agenda page", "minutes page", "url", "website"] },
  "plugin.meeting_summary.youtube_channel_id": { label: "YouTube channel ID", words: ["youtube", "video", "recordings", "channel"] },
  "plugin.meeting_summary.title_filter": { label: "Only meetings whose title contains", words: ["filter", "include meetings"] },
  "plugin.meeting_summary.type_exclude": { label: "Skip meetings whose title contains", words: ["exclude", "skip", "ignore meetings"] },
  "plugin.meeting_summary.cutoff_date": { label: "Ignore meetings before", words: ["start date", "cutoff", "older meetings"] },
  "plugin.meeting_summary.auto_publish": { label: "Publish summaries without review", words: ["auto publish", "automatic", "skip review", "review summaries"] },
  "plugin.meeting_summary.extraction_instructions": { label: "Extra instructions for the summarizer", words: ["ai instructions", "prompt", "summarizer", "summariser"] },
  "plugin.meeting_summary.wix_fields": { label: "Wix collection columns", words: ["wix", "columns", "fields", "mapping"] },
  "plugin.meeting_summary.record_grace_days": { label: "Wait for a meeting's record", words: ["grace", "wait", "delay", "days"] },
  "plugin.meeting_summary.source_quiet_days": { label: "Ask for a check after no new meeting for", words: ["quiet", "stale", "no new meetings", "alert"] },
  "plugin.news_sync.connector": { label: "Kind of feed", words: ["rss", "atom", "news feed type"] },
  "plugin.news_sync.source_url": { label: "Feed address", words: ["rss url", "feed url", "news url"] },
  "plugin.digest.send_hour": { label: "Send time", words: ["digest time", "email time", "when emails go out", "hour"] },
  "plugin.feedback.contact_email": { label: "Address on the Feedback page", words: ["feedback email", "contact email", "support address"] },
  "plugin.members.min_count": { label: "Show members from", words: ["member threshold", "minimum members", "member count"] },
  "plugin.members.page_before_threshold": { label: "Show the Members page before then", words: ["members page", "early"] },
  "plugin.analytics.public_numbers": { label: "Public numbers", words: ["public stats", "public analytics", "transparency", "open data"] },
};

/** One thing the search can find. */
export interface SearchEntry {
  key: string;
  label: string;
  /** Where it is, for the result's second line: "Plugins › Votes". */
  where: string;
  /** The link: "/admin/settings/mode#mode-waitlist". */
  path: string;
  words: readonly string[];
  /** The help note, searched last. */
  text: string;
}

const NAV_LABEL: Readonly<Record<SettingsNavId, string>> = Object.fromEntries(
  SETTINGS_NAV.map((s) => [s.id, s.label]),
) as Record<SettingsNavId, string>;

const PLUGIN_BY_ID = new Map(PLUGIN_SECTION_INFO.map((p) => [p.id as string, p]));

/** The plugin a setting belongs to (`plugin.<id>.<name>`), when it is one of a plugin's fields. */
function pluginOfSetting(key: string) {
  return PLUGIN_SECTION_INFO.find(
    (p) => key === `plugin.${p.id}.enabled` || p.fields.some((f) => f.key === key),
  );
}

/** The Settings section an editable setting is on (identity.theme is on Appearance). */
function sectionOfSetting(key: string): SettingsNavId | null {
  for (const id of SETTINGS_SECTION_IDS) {
    if (SETTINGS_SECTIONS[id].some((f) => f.key === key)) return isSettingsNavId(id) ? id : null;
  }
  return null;
}

/**
 * Where a help key is: its section and, but for a whole section, the anchor
 * its "?" carries. Null for a key that names no place in Hub settings.
 */
export function pathForKey(key: string): { section: SettingsNavId; path: string; plugin?: string } | null {
  const [head, ...rest] = key.split(".");
  const tail = rest.join(".");
  if (head === "settings") {
    return isSettingsNavId(tail) ? { section: tail, path: `/admin/settings/${tail}` } : null;
  }
  if (head === "plugins" && PLUGIN_BY_ID.has(tail)) {
    return { section: "plugins", path: `/admin/settings/plugins#${anchorForKey(key)}`, plugin: tail };
  }
  const section = sectionOfSetting(key);
  if (section) {
    const plugin = section === "plugins" ? pluginOfSetting(key)?.id : undefined;
    return { section, path: `/admin/settings/${section}#${anchorForKey(key)}`, plugin };
  }
  if (head && isSettingsNavId(head)) return { section: head, path: `/admin/settings/${head}#${anchorForKey(key)}` };
  return null;
}

/**
 * The anchors inside a plugin's panel: its own "?", its switch and each of
 * its settings. The panel opens when the address names any of them.
 */
export function pluginPanelAnchors(id: string): string[] {
  const p = PLUGIN_BY_ID.get(id);
  return [
    anchorForKey(`plugins.${id}`),
    anchorForKey(`plugin.${id}.enabled`),
    ...(p?.fields.map((f) => anchorForKey(f.key)) ?? []),
  ];
}

/** Every help key the search covers, with its words, place and note. */
export function buildSearchIndex(): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const [key, help] of Object.entries(HELP)) {
    if (key in NOT_IN_SEARCH) continue;
    const place = pathForKey(key);
    if (!place) continue;
    const plugin = place.plugin ? PLUGIN_BY_ID.get(place.plugin) : undefined;
    const own = plugin?.search?.[key];
    const hub = SEARCH_WORDS[key];
    const isSection = key.startsWith("settings.");
    const isPanel = key === `plugins.${place.plugin}`;
    const label = own?.label ?? hub?.label ?? (isSection ? NAV_LABEL[place.section] : isPanel ? plugin?.name : undefined);
    if (!label) continue; // tests/unit/settingsSearch.test.ts makes sure this never happens
    const words = [...(own?.words ?? hub?.words ?? []), ...(isPanel ? SWITCH_WORDS : [])];
    const where = isSection
      ? "Hub settings"
      : plugin && !isPanel
        ? `${NAV_LABEL[place.section]} › ${plugin.name}`
        : NAV_LABEL[place.section];
    const text = isPanel && plugin ? `${plugin.what} ${help.text}` : help.text;
    out.push({ key, label, where, path: place.path, words, text });
  }
  return out;
}

// ---- Matching -------------------------------------------------------------

/** Words that say nothing about which setting is meant. */
const STOP = new Set([
  "a", "an", "the", "to", "of", "for", "in", "on", "my", "our", "i", "how", "do", "can", "where", "is", "it",
  "change", "set", "edit", "setting", "settings", "and", "or", "what", "who", "this", "hub", "page",
]);

/** Spellings that mean the same, in both directions. */
const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ["colour", "color"],
  ["colours", "colors"],
  ["organisation", "organization"],
  ["behaviour", "behavior"],
  ["neighbour", "neighbor"],
  ["summarise", "summarize"],
  ["centre", "center"],
  ["login", "sign in"],
  ["signin", "sign in"],
  ["signup", "sign up"],
  ["whitelist", "allowlist"],
];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function variants(token: string): string[] {
  const out = new Set([token]);
  for (const [a, b] of SPELLINGS) {
    if (token === a) out.add(b.replace(/ /g, ""));
    if (token === b) out.add(a);
  }
  // A plural finds its singular ("admins" → "admin").
  if (token.length > 3 && token.endsWith("s")) out.add(token.slice(0, -1));
  return [...out];
}

/** At most one letter added, dropped, changed or two swapped. */
function nearlyEqual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return Math.abs(a.length - b.length) <= 1;
  const swap = a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  return (
    swap ||
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i) ||
    a.slice(i) === b.slice(i + 1)
  );
}

interface Field {
  words: string[];
  joined: string;
}

function field(s: string): Field {
  const n = normalize(s);
  return { words: n ? n.split(" ") : [], joined: n.replace(/ /g, "") };
}

/** How well one query word matches a field: 3 a word's start, 2 inside a joined phrase, 1 a near miss, 0 not at all. */
function tokenMatch(token: string, f: Field): number {
  let best = 0;
  for (const v of variants(token)) {
    if (f.words.some((w) => w.startsWith(v))) return 3;
    if (v.length >= 4 && f.joined.includes(v)) best = Math.max(best, 2);
    if (v.length >= 5 && f.words.some((w) => nearlyEqual(w, v) || (w.length > v.length && nearlyEqual(w.slice(0, v.length), v)))) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

const WEIGHTS = { label: 10, words: 6, where: 3, text: 1 } as const;

interface Prepared {
  entry: SearchEntry;
  order: number;
  label: Field;
  words: Field[];
  where: Field;
  text: Field;
}

export function prepareIndex(entries: readonly SearchEntry[]): Prepared[] {
  return entries.map((entry, order) => ({
    entry,
    order,
    label: field(entry.label),
    words: entry.words.map(field),
    where: field(entry.where),
    text: field(entry.text),
  }));
}

/**
 * The entries that match every word of the query, best first. A label beats
 * a synonym, which beats where it is, which beats the help note; the whole
 * query run together ("waitlist" for "wait list") counts extra.
 */
export function searchSettings(query: string, index: readonly Prepared[], limit = 8): SearchEntry[] {
  const all = normalize(query).split(" ").filter(Boolean);
  const tokens = all.filter((t) => !STOP.has(t));
  const used = tokens.length > 0 ? tokens : all;
  if (used.length === 0) return [];
  const joined = used.join("");

  const scored: Array<{ p: Prepared; score: number; nearMiss: boolean }> = [];
  for (const p of index) {
    let score = 0;
    let ok = true;
    let nearMiss = false;
    for (const t of used) {
      const label = tokenMatch(t, p.label);
      const words = Math.max(0, ...p.words.map((w) => tokenMatch(t, w)));
      const where = tokenMatch(t, p.where);
      const text = tokenMatch(t, p.text);
      const best = Math.max(label * WEIGHTS.label, words * WEIGHTS.words, where * WEIGHTS.where, text * WEIGHTS.text);
      if (best === 0) {
        ok = false;
        break;
      }
      if (Math.max(label, words, where, text) === 1) nearMiss = true;
      score += best;
    }
    if (!ok) continue;
    if (used.length > 1 || joined.length >= 4) {
      if (p.label.joined.includes(joined)) score += 20;
      else if (p.words.some((w) => w.joined.includes(joined))) score += 12;
    }
    if (p.label.joined === joined) score += 15;
    scored.push({ p, score, nearMiss });
  }
  // A misspelling is a way in only when nothing is spelled as typed.
  const exact = scored.filter((s) => !s.nearMiss);
  const kept = exact.length > 0 ? exact : scored;
  kept.sort((a, b) => b.score - a.score || a.p.order - b.p.order);
  // Far weaker than the best (found only in a help note) is noise beside it.
  const floor = (kept[0]?.score ?? 0) * 0.3;
  return kept
    .filter((s) => s.score >= floor)
    .slice(0, limit)
    .map((s) => s.p.entry);
}
