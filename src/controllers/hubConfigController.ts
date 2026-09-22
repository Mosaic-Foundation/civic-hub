// GET /hub-config (served as /api/hub-config) — the public face of a hub's
// configuration, for the UI to read at boot instead of baking it into the
// bundle at build time.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings" for the
// key names and the public subset, and "4. Request flow" item 5 for the
// response shape.
//
// PHASE 1 PART ONE. The values still come from environment variables; only
// their NAMES have moved to the new dotted scheme, via the alias map in the
// build plan. Part two moves the storage into hub_settings rows without
// changing this response, so the UI never learns where a value came from.
//
// WHAT MAY APPEAR HERE. Only keys on the build plan's public list. The public
// subset is a list of keys, not of namespaces, so a new key is admin-only
// until it is deliberately added. In particular the demo bypass code and the
// beta allowlist are never served here, however convenient it would be.

import type { Request, Response } from "express";
import { getCommentIdentityMode } from "../services/hubSettings.js";
import type { Hub } from "../models/hub.js";

/** The hub fields the contract makes public. */
interface PublicHub {
  id: string;
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  space_did: string;
}

export interface HubConfigResponse {
  hub: PublicHub;
  settings: Record<string, string>;
}

function publicHub(hub: Hub): PublicHub {
  return {
    id: hub.id,
    name: hub.name,
    hostname: hub.hostname,
    jurisdiction_code: hub.jurisdiction_code,
    jurisdiction_name: hub.jurisdiction_name,
    space_did: hub.space_did,
  };
}

/** Trimmed env var, or undefined when unset or blank. */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Add a key only when there is a value, so absent means "not configured". */
function put(
  out: Record<string, string>,
  key: string,
  value: string | undefined | null,
): void {
  if (value !== undefined && value !== null && value !== "") out[key] = value;
}

/**
 * A plugin's enabled flag. Everything is on unless explicitly switched off,
 * which is how the env vars behave today — changing that default here would
 * silently disable features on deployments that never set the variable.
 */
function enabledFlag(varName: string): string {
  return env(varName) === "false" ? "false" : "true";
}

/**
 * The public settings for a hub.
 *
 * Reads env vars under their new key names. `VITE_`-prefixed variables are
 * read here, server-side, on purpose: they are the values an operator has
 * already configured for this deployment, and Phase 1 part two replaces this
 * whole function body with a hub_settings lookup.
 */
async function publicSettings(hub: Hub): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // identity.* — the hub's own name comes from the row, not from env, since
  // the row is now the source of truth for it.
  put(out, "identity.name", hub.name);
  put(out, "identity.label", env("VITE_HUB_LABEL"));
  put(out, "identity.tagline", env("VITE_HUB_TAGLINE"));
  put(out, "identity.page_title", env("VITE_HUB_PAGE_TITLE"));
  put(out, "identity.description", env("VITE_HUB_DESCRIPTION"));
  put(out, "identity.banner_url", env("VITE_HUB_BANNER_URL"));
  put(out, "identity.banner_alt", env("VITE_HUB_BANNER_ALT"));
  put(out, "identity.theme", env("VITE_HUB_THEME"));

  // copy.*
  put(out, "copy.intro_body", env("VITE_HUB_INTRO_BODY"));
  put(out, "copy.residency_intro", env("VITE_HUB_RESIDENCY_INTRO"));
  put(out, "copy.governing_body_name", env("VITE_HUB_GOVERNING_BODY_NAME"));
  put(out, "copy.governing_body_short", env("VITE_HUB_GOVERNING_BODY_SHORT"));

  // moderation.* — already a hub_settings row today, under its old key. The
  // reader owns the alias; this just asks for the value.
  put(out, "moderation.comment_identity_mode", await safeCommentIdentityMode());

  // beta.*  (beta.allowlist is admin-only and must never appear here)
  put(
    out,
    "beta.enabled",
    env("CIVIC_BETA_MODE") === "true" || env("VITE_BETA_MODE") === "true"
      ? "true"
      : "false",
  );

  // plugin.<id>.enabled
  put(out, "plugin.digest.enabled", enabledFlag("DIGEST_ENABLED"));
  put(out, "plugin.admin_digest.enabled", enabledFlag("ADMIN_DIGEST_ENABLED"));
  put(
    out,
    "plugin.meeting_summary.enabled",
    enabledFlag("MEETING_SUMMARY_ENABLED"),
  );
  put(out, "plugin.news_sync.enabled", enabledFlag("FLOYD_NEWS_SYNC_ENABLED"));
  // A conversations plugin with no Polis instance behind it is off.
  const polisUrl = env("VITE_HUB_POLIS_URL") ?? env("POLIS_BASE_URL");
  put(out, "plugin.conversation.enabled", polisUrl ? "true" : "false");

  // --- PENDING ADAM'S CONFIRMATION ---------------------------------------
  // These two are `plugin.<id>.<setting>` keys, which the build plan's public
  // subset does not include — it lists only `plugin.<id>.enabled`. They are
  // served anyway because the UI cannot work without them: the Conversations
  // nav item needs the Polis URL to link to, and the onboarding flow needs
  // the wordcloud's process id.
  //
  // Serving them leaks nothing. Both are already in the client bundle today
  // as VITE_ variables, readable by anyone who views source, and both are
  // public by nature: a URL that gets rendered as a link, and the id of a
  // public process. The alternative — leaving these two reading build-time
  // env in the UI while the other eleven come from the endpoint — would mean
  // a second hub could never have its own conversations.
  //
  // Adam to confirm adding these two key names to the public list in
  // BUILD-PLAN-multi-tenant.md. Until then the contract document is
  // unchanged and this is the only place the difference lives.
  put(out, "plugin.conversation.polis_url", polisUrl);
  put(
    out,
    "plugin.wordcloud.onboarding_id",
    env("VITE_HUB_ONBOARDING_WORDCLOUD_ID"),
  );
  // -----------------------------------------------------------------------

  return out;
}

/**
 * The comment identity mode, or undefined if it cannot be read. A settings
 * table that is briefly unreachable must not take down the whole config
 * response — the UI has a safe default for this one, and losing it degrades
 * a toggle rather than the page.
 */
async function safeCommentIdentityMode(): Promise<string | undefined> {
  try {
    return await getCommentIdentityMode();
  } catch (e) {
    console.error(
      `[hub-config] comment identity mode unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}

export async function handleGetHubConfig(
  req: Request,
  res: Response,
): Promise<void> {
  const hub = req.hub;
  if (!hub) {
    // Unreachable in practice: the resolver answers before any handler runs.
    // Explicit anyway, so a future change to middleware order fails loudly
    // instead of serving a config with no hub behind it.
    res.status(404).json({ error: "no_hub" });
    return;
  }

  const settings = await publicSettings(hub);

  // `private`, not `public`: this response differs per hostname, and a shared
  // cache that keyed it wrongly would serve one hub's identity on another's
  // domain. Sixty seconds in the browser is all the caching this needs.
  res.set("Cache-Control", "private, max-age=60");
  const body: HubConfigResponse = { hub: publicHub(hub), settings };
  res.json(body);
}
