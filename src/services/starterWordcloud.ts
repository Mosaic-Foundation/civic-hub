// Every hub starts with something to look at (admin menu slice, 2026-10-13):
// one open word cloud with a general starter prompt, chosen as the hub's word
// cloud, so the strip at the top of every page has something in it from day
// one. The admin can switch the strip to None or to another word cloud in
// Settings → Plugins → Word clouds.
//
// Adam's decision (2026-10-13): the starter is real content, never a sample,
// so it survives sample removal; but a demo hub's visitors must never write
// into the real record, so a hub created WITH samples shows the sample word
// cloud, and gets the starter only when that sample goes (one at a time, or
// all at once). A hub whose samples have none (some kinds) gets it at once.
//
// The prompt names no place (the place-name rule): it reads right in a town,
// a school district, an organization or a campaign.
//
// Callers: hub creation (src/control/inHub.ts: the console, the start page,
// scripts/create-hub.ts), sample removal (src/services/sampleContent.ts), and
// scripts/add-starter-wordcloud.ts for hubs made before this existed.

import { createProcess, executeAction, getProcess } from "./processService.js";
import { getSetting, isPluginEnabled, setSetting } from "./hubSettings.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { currentHubId } from "../config/hubContext.js";
import { KEYS } from "../models/hubSettings.js";

export const STARTER_WORDCLOUD = {
  title: "What matters most to you?",
  description: "One word is enough. Answers appear in the cloud as they come in.",
  prompt: "In one word, what matters most to you about this community?",
} as const;

/** Who the starter is recorded as made by: the platform, at the hub's start. */
export const STARTER_ACTOR = "system:starter";

export type StarterOutcome =
  | { created: string }
  | { skipped: "plugin_off" | "has_wordcloud" | "chosen_none" };

/**
 * Add the starter word cloud and choose it, unless the hub has one chosen,
 * its Word clouds plugin is off, or (with `respectNone`) someone has set the
 * choice to None. `by` is who the setting change and the admin log name.
 */
export async function ensureStarterWordcloud(
  by: string,
  opts: { respectNone?: boolean } = {},
): Promise<StarterOutcome> {
  const hubId = currentHubId();
  if (!(await isPluginEnabled(hubId, "wordcloud"))) return { skipped: "plugin_off" };

  const chosen = await getSetting(hubId, KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID);
  if (chosen && (await getProcess(chosen))) return { skipped: "has_wordcloud" };
  // An empty value someone saved is a choice of None; no row is no choice.
  if (opts.respectNone && (await fetchHubSettings(hubId))?.[KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID] === "") {
    return { skipped: "chosen_none" };
  }

  const process = await createProcess({
    definition: { type: "civic.wordcloud", version: "0.1" },
    title: STARTER_WORDCLOUD.title,
    description: STARTER_WORDCLOUD.description,
    createdBy: STARTER_ACTOR,
    state: { prompts: [{ id: "p1", text: STARTER_WORDCLOUD.prompt }], lifecycle_mode: "evergreen" },
  });
  await executeAction(process.id, { type: "process.activate", actor: STARTER_ACTOR, payload: {} }, "admin");
  await setSetting(hubId, KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID, process.id, by);
  await recordHubAdminAudit({
    actor: by,
    action: "wordcloud.starter",
    before: { chosen: chosen ?? null },
    after: { process_id: process.id, title: STARTER_WORDCLOUD.title },
  });
  console.log(`[hub] starter word cloud ${process.id} added on ${hubId} by ${by}`);
  return { created: process.id };
}
