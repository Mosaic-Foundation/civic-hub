// Who writes which hub setting: the platform's console, or the hub's own
// admins (review R10, decided by Adam 2026-10-08).
//
// The rule, in one line each:
//   - What residents see belongs to the hub's admins. The console may set it
//     while the hub is a demo, before it is handed over (the Handover panel),
//     and shows it read-only, with a link to the hub's Settings, after that.
//   - The hub's mode belongs to its admins (Settings → Mode). The console
//     creates a hub in a mode and then shows it read-only.
//   - Plugin switches belong to the hub's admins. The console sets them at
//     create and then shows them read-only.
//   - The web address, status (paused) and archive belong to the console.
//   - The admin list has two writers on purpose: the console is the way back
//     in when a hub has lost its admins. Both take a fresh code and both send
//     the invite, and both pages say the other can change it.
//
// Shared by the server (which refuses a write from the wrong place) and both
// UIs (which render the other place's fields read-only). Pure.

/**
 * The resident-facing settings the console's Handover panel edits while the
 * hub is a demo. In the order the panel lists them.
 */
export const HANDOVER_KEYS = [
  "identity.name",
  "legal.operator_name",
  "legal.contact_email",
  "legal.who_runs_this",
  "email.from_name",
  "email.postal_address",
  "plugin.feedback.contact_email",
  "copy.governing_body_name",
  "copy.governing_body_short",
] as const;

export type HandoverKey = (typeof HANDOVER_KEYS)[number];

export function isHandoverKey(key: string): key is HandoverKey {
  return (HANDOVER_KEYS as readonly string[]).includes(key);
}

/**
 * May the console change the hub's resident-facing settings now? Only while
 * the hub is a demo: once its admins have moved it to beta or live, it is
 * theirs. A hub with no mode set (an old row) is not a demo.
 */
export function consoleOwnsHandoverKeys(mode: string | null | undefined): boolean {
  return mode === "demo";
}

/** Said wherever the console refuses, or shows read-only, a handed-over value. */
export const HANDED_OVER_NOTE =
  "This hub has left demo, so what residents see is its admins' to change, in the hub's own Settings.";

/** Said wherever the console shows the mode read-only. */
export const MODE_OWNER_NOTE =
  "The hub's admins change its mode in the hub's Settings → Mode (demo → beta → live). A hub never goes back to demo.";

/** Said wherever the console shows the plugin switches read-only. */
export const PLUGINS_OWNER_NOTE =
  "The hub's admins switch plugins on and off in the hub's Settings → Plugins. The create form sets where they start.";

/** A hub's Settings page, from the console: `https://<hostname>/admin/settings/<section>`. */
export function hubSettingsUrl(hostname: string, section: string): string {
  const local = /(^|\.)localhost$/.test(hostname) || hostname.startsWith("127.");
  return `${local ? "http" : "https"}://${hostname}/admin/settings/${section}`;
}

/** The keys that follow the hub's name when it is renamed. */
export const RENAME_FOLLOWERS = ["identity.name", "legal.operator_name", "email.from_name"] as const;

/**
 * What a rename from `oldName` to `newName` carries with it (review R11): each
 * of RENAME_FOLLOWERS whose value is still exactly the old name — the value
 * create wrote — becomes the new one. A value someone has made their own (an
 * operator that is a town office) is left alone. Returns only the keys that
 * change.
 */
export function renameFollowers(
  oldName: string,
  newName: string,
  current: Readonly<Record<string, string | undefined>>,
  keys: readonly string[] = RENAME_FOLLOWERS,
): Record<string, string> {
  const from = oldName.trim();
  const to = newName.trim();
  const out: Record<string, string> = {};
  if (!from || !to || from === to) return out;
  for (const key of keys) {
    if ((current[key] ?? "").trim() === from) out[key] = to;
  }
  return out;
}

/** How each follower is named when a page says what a rename changed. */
export const SETTING_LABELS: Readonly<Record<string, string>> = {
  "identity.name": "Hub name",
  "legal.operator_name": "Operated by",
  "legal.contact_email": "Contact address",
  "legal.who_runs_this": '"Who runs this site"',
  "email.from_name": "Email from name",
  "email.postal_address": "Postal address",
  "plugin.feedback.contact_email": "Feedback address",
  "copy.governing_body_name": "Governing body",
  "copy.governing_body_short": "Board label",
  "hubs.name": "Registry name",
};
