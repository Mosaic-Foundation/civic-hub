// The hub admin settings endpoint — one reader and one writer for every value
// on the Settings page's Identity, Copy & pages, Legal and Email sections.
//
//   GET  /admin/hub/settings                  every editable value, with who
//                                             changed it and when
//   PUT  /admin/hub/settings                  { section, values } — writes
//                                             only that section's keys
//   GET  /admin/hub/settings/template/:key    a document's shared default,
//                                             for "restore default"
//
// Mounted under /admin, so requireAdmin has already run: the caller is an
// admin OF THE HUB THIS HOSTNAME RESOLVED TO. Sessions are bound to the hub
// they were minted on and rosters are per hub, so there is no hub parameter
// to get wrong — an Athens admin's token is not a session at all on Floyd's
// hostname.
//
// Key names are checked against src/shared/hubSettingsSections.ts, which is
// the build plan's "Hub admin edits in the UI" table. An unknown key is
// refused and nothing in the write is stored.

import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { currentHub, currentHubId } from "../config/hubContext.js";
import {
  getAllSettings,
  getSetting,
  hubModeFor,
  setSettings,
} from "../services/hubSettings.js";
import { KEYS, KEY_ALIASES } from "../models/hubSettings.js";
import { validateSettingsWrite } from "../models/hubSettingsWrite.js";
import {
  EDITABLE_SETTING_KEYS,
  fieldSpec,
} from "../shared/hubSettingsSections.js";
import { documentTemplate } from "../services/hubDocuments.js";
import { getUser } from "../modules/civic.auth/index.js";

export interface HubSettingsResponse {
  hub: {
    id: string;
    /** The name in the hub registry, which `identity.name` overrides for display. */
    registry_name: string;
    hostname: string;
    jurisdiction_name: string | null;
    mode: string;
  };
  /** The hub's own value for every editable key; "" where it has none. */
  values: Record<string, string>;
  /**
   * What applies when the hub has no value of its own — the deployment's
   * environment variable, where the key has one. The form shows it as a
   * placeholder, never as a value the admin must keep.
   */
  fallbacks: Record<string, string>;
  /** Per key, when the hub's own row last changed and who changed it. */
  changed: Record<string, { at: string; by: string | null }>;
  /** Values the platform sets, shown read-only. */
  platform: { from_address: string };
  /** Document keys that have a shared default to restore. */
  restorable: string[];
}

async function loadHubSettings(): Promise<HubSettingsResponse> {
  const hub = currentHub();
  const hubId = currentHubId();
  const rows = await getAllSettings(hubId);

  const values: Record<string, string> = {};
  const fallbacks: Record<string, string> = {};
  const changed: Record<string, { at: string; by: string | null }> = {};
  const actorIds = new Set<string>();

  for (const key of EDITABLE_SETTING_KEYS) {
    const alias = KEY_ALIASES[key];
    const row = rows[key] ?? (alias ? rows[alias] : undefined);
    values[key] = row?.value ?? "";
    if (row) {
      changed[key] = { at: row.updated_at, by: row.updated_by };
      if (row.updated_by) actorIds.add(row.updated_by);
    }
    // getSetting with no hub answers from the environment only.
    const fallback = await getSetting(null, key);
    if (fallback) fallbacks[key] = fallback;
  }

  // Names rather than ids: "last changed by usr_8f2…" tells an admin nothing.
  const names = new Map<string, string>();
  await Promise.all(
    [...actorIds].map(async (id) => {
      const user = await getUser(id).catch(() => undefined);
      if (user) names.set(id, user.full_name || user.display_name || user.email);
    }),
  );
  for (const entry of Object.values(changed)) {
    if (entry.by) entry.by = names.get(entry.by) ?? null;
  }

  const restorable = EDITABLE_SETTING_KEYS.filter((key) => {
    const kind = fieldSpec(key)?.kind;
    return (kind === "document" || key === KEYS.LEGAL_WHO_RUNS_THIS) && documentTemplate(key) !== null;
  });

  return {
    hub: {
      id: hubId,
      registry_name: hub?.name ?? "",
      hostname: hub?.hostname ?? "",
      jurisdiction_name: hub?.jurisdiction_name ?? null,
      mode: hubModeFor(hub),
    },
    values,
    fallbacks,
    changed,
    platform: {
      from_address: (await getSetting(hubId, KEYS.EMAIL_FROM_ADDRESS)) ?? "",
    },
    restorable,
  };
}

export async function handleGetHubSettings(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await loadHubSettings());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handlePutHubSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { section?: unknown; values?: unknown };
    const result = validateSettingsWrite(body.section, body.values);
    if (!result.ok) {
      res.status(400).json({
        error: result.error,
        ...(result.unknownKeys ? { unknown_keys: result.unknownKeys } : {}),
      });
      return;
    }

    // A document saved exactly as its shared template is stored as "" — the
    // hub is USING the default, not holding a copy of it. That is what
    // "restore default" means: a copy would stop following the template the
    // next time the shared text is corrected, and nobody would know why.
    const entries = result.entries.map((e) => {
      const template = documentTemplate(e.key);
      return template !== null && e.value.trim() === template.trim()
        ? { key: e.key, value: "" }
        : e;
    });

    const actor = getAuthUser(res);
    const hubId = currentHubId();
    await setSettings(hubId, entries, actor.id);

    // One line per save, naming who and which keys — never the values, which
    // include whole documents.
    console.log(
      `[hub-settings] ${hubId}: ${actor.email} saved ${result.section} ` +
        `(${entries.map((e) => e.key).join(", ")})`,
    );

    res.json(await loadHubSettings());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetSettingTemplate(req: Request, res: Response): Promise<void> {
  const key = String(req.params.key ?? "");
  const spec = fieldSpec(key);
  if (!spec) {
    res.status(400).json({ error: `Unknown setting: ${key}.` });
    return;
  }
  const template = documentTemplate(key);
  if (template === null) {
    res.status(404).json({ error: `${key} has no shared default.` });
    return;
  }
  res.json({ key, template });
}
