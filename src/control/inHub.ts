// Work the control plane does inside one hub's own scope, as a request for
// that hub would run it: the sample seed, the admin invite, and (for the
// start page) the handoff session. Shared by the console (./router.ts) and
// the start page (./startRouter.ts).

import { getHubBySlug } from "../db/hubs.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { withHubScope } from "../config/hubContext.js";
import { seedSampleContent, type SampleSeedReport } from "../services/sampleSeed.js";
import { sendAdminInvites, type InviteReport } from "../services/adminInvite.js";
import { createHandoffSession } from "../modules/civic.auth/index.js";
import { uiBaseUrl } from "../utils/baseUrl.js";

/** Run `fn` with the hub in scope (its row and settings, read fresh). */
export async function inHubScope<T>(hubId: string, fn: () => Promise<T>): Promise<T> {
  const row = await getHubBySlug(hubId);
  if (!row) throw new Error(`hub ${hubId} not found`);
  const settings = await fetchHubSettings(hubId);
  return withHubScope(row, settings, fn);
}

/** Seed the sample content inside the hub's own scope. */
export async function seedSampleInHub(hubId: string): Promise<SampleSeedReport> {
  return inHubScope(hubId, () => seedSampleContent());
}

/** Email the admin invite from inside the hub's scope (sender, link and mode are the hub's). */
export async function inviteAdmins(hubId: string, emails: readonly string[]): Promise<InviteReport> {
  if (emails.length === 0) return { sent: [], not_sent: [] };
  try {
    return await inHubScope(hubId, () => sendAdminInvites(emails));
  } catch (err) {
    console.error(`[control] admin invite for ${hubId} failed`, err);
    return { sent: [], not_sent: emails.map((email) => ({ email, reason: "The email could not be sent." })) };
  }
}

/**
 * Where to send a person who has just created this hub: its front page with
 * a two-minute handoff token in the fragment, which the hub's page swaps
 * for a session (POST /auth/handoff). Creates their account on the hub.
 */
export async function handoffUrl(hubId: string, email: string): Promise<string> {
  return inHubScope(hubId, async () => {
    const token = await createHandoffSession(email);
    return `${uiBaseUrl()}/#handoff=${encodeURIComponent(token)}`;
  });
}
