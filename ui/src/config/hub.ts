/**
 * Hub branding — read from the API at boot, with build-time VITE_HUB_*
 * variables as fallbacks.
 *
 * This used to be a plain object evaluated at import time from VITE_HUB_*
 * env vars, so each deployment baked one hub's identity into its bundle.
 * With one deployment serving many hubs, identity is decided by the hostname
 * at request time: main.tsx fetches /api/hub-config before React renders, and
 * every property below reads that response.
 *
 * The shape and the import surface are unchanged on purpose — every consumer
 * still writes `hub.name`. The properties are getters, so they resolve when
 * read rather than when this module is imported, which is what lets the fetch
 * happen first without every caller having to await anything.
 *
 * Resolution order for each field:
 *   1. the value the hub serves from /api/hub-config
 *   2. the VITE_HUB_* build-time variable, for a single-hub self-hosted
 *      deployment or when the fetch failed
 *   3. the default baked in below
 *
 * NOT here, and never to be added: anything to do with the demo sign-in
 * bypass. A demo hub is a server-side settings row and accepts any six
 * digits, so the client holds no code at all.
 *
 * To add a field: add the settings key to the server's public subset in
 * src/controllers/hubConfigController.ts, then add a getter here. Keep the
 * fallback accurate so deployments without the row keep working.
 */

import { getLoadedHubConfig, setting } from "./hubConfig";

/** Env var, trimmed, or undefined when unset or blank. */
function env(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * The hub's display name, for the copy fallbacks below that mention it.
 * Duplicates `hub.name`'s resolution rather than reading `this.name`, because
 * these getters are read through destructured references often enough that
 * `this` cannot be relied on.
 */
function hubDisplayName(): string {
  return (
    getLoadedHubConfig()?.hub.name ??
    env(import.meta.env.VITE_HUB_NAME) ??
    "this hub"
  );
}

const hub = {
  /**
   * Display name / wordmark — top-nav, footer, intro popup, settings,
   * search header, and {HUB_NAME} in every document. Not the geographic
   * jurisdiction.
   *
   * TWO SOURCES, AND THE SETTING WINS (2026-09-23). `hubs.name` is the
   * REGISTRY name: what the control plane calls this tenant, stable, and
   * not something a hub admin should be able to edit — renaming your own
   * row in a shared registry is a control-plane act. `identity.name` is the
   * DISPLAY name, which is the hub's own business.
   *
   * They were the same thing until an admin wanted to be "Floyd County
   * Civic Hub" rather than "Floyd Civic Hub", so as not to be mistaken for
   * the Town of Floyd — a distinction only that hub knows it needs. The
   * settings key had existed since Phase 1 part one and nothing read it.
   */
  get name(): string {
    return (
      setting("identity.name") ??
      getLoadedHubConfig()?.hub.name ??
      env(import.meta.env.VITE_HUB_NAME) ??
      "Civic Hub"
    );
  },

  /**
   * Geographic jurisdiction — banner, hub-info card, residency copy. The
   * place this hub serves, which stays accurate even when `name` is
   * rebranded for demo or white-label use.
   */
  get jurisdiction(): string {
    return (
      getLoadedHubConfig()?.hub.jurisdiction_name ??
      env(import.meta.env.VITE_HUB_JURISDICTION) ??
      ""
    );
  },

  /**
   * The place on its own — "Floyd County" out of "Floyd County, Virginia".
   *
   * The same derivation the server does for `{PLACE}` in the shared
   * documents, so prose that names the place reads the same on both sides.
   * A hub with no jurisdiction gets "where you live", which is the phrasing
   * that survives having no place at all.
   */
  get place(): string {
    const [first] = (this.jurisdiction ?? "").split(",");
    return first?.trim() || "where you live";
  },

  /** Type label — small caps under the jurisdiction on the banner. */
  get label(): string {
    return (
      setting("identity.label") ?? env(import.meta.env.VITE_HUB_LABEL) ?? "Civic Hub"
    );
  },

  /** One-sentence tagline rendered under the jurisdiction. */
  get tagline(): string {
    return (
      setting("identity.tagline") ??
      env(import.meta.env.VITE_HUB_TAGLINE) ??
      "Stay informed on local government, raise the issues that matter, work on projects together, and see where our community stands."
    );
  },

  /**
   * Banner image path, relative to the deployment root. Drop new banner
   * files into ui/public/ and point the hub's setting at their path.
   */
  /**
   * Banner image path, relative to the deployment root. Drop new banner
   * files into ui/public/ and point the hub's setting at their path.
   *
   * EMPTY WHEN A HUB HAS NOT CHOSEN ONE, and HubBanner then renders nothing.
   * The default used to be Floyd's photograph, so a hub with no banner set
   * showed a picture of somewhere else as its own header — which is worse
   * than showing no picture, and was doing exactly that on Utopia.
   */
  get banner_url(): string {
    return (
      setting("identity.banner_url") ??
      env(import.meta.env.VITE_HUB_BANNER_URL) ??
      ""
    );
  },

  /** A small image beside the hub's name in the header. Empty = none. */
  get logo_url(): string {
    return setting("identity.logo_url") ?? "";
  },

  /** The accent colour, #rrggbb, or empty for the default palette. */
  get theme(): string {
    return (
      setting("identity.theme") ?? env(import.meta.env.VITE_HUB_THEME) ?? ""
    );
  },

  /** Alt text for the banner — also used as og:image:alt. */
  get banner_alt(): string {
    return (
      setting("identity.banner_alt") ??
      env(import.meta.env.VITE_HUB_BANNER_ALT) ??
      ""
    );
  },

  /**
   * Governance terminology. The elected body votes are delivered to and
   * whose meetings get summarized: a Board of Supervisors, a Town Council,
   * a City Council. The long form is for delivered-to text and admin pages;
   * the short form is for pills and filter labels where width matters.
   */
  get governing_body_name(): string {
    return (
      setting("copy.governing_body_name") ??
      env(import.meta.env.VITE_HUB_GOVERNING_BODY_NAME) ??
      "Governing Body"
    );
  },

  get governing_body_short(): string {
    return (
      setting("copy.governing_body_short") ??
      env(import.meta.env.VITE_HUB_GOVERNING_BODY_SHORT) ??
      "Board"
    );
  },

  /** Welcome-popup body and the residency-intro copy in the auth modal. */
  get intro_body(): string {
    return (
      setting("copy.intro_body") ??
      env(import.meta.env.VITE_HUB_INTRO_BODY) ??
      "This is where residents keep up with local government, raise topics that matter, help make sense of issues together, and have conversations to see where the community stands."
    );
  },

  get residency_intro(): string {
    return (
      setting("copy.residency_intro") ??
      env(import.meta.env.VITE_HUB_RESIDENCY_INTRO) ??
      `To participate in ${hubDisplayName()}, please confirm your residency and review the policies below.`
    );
  },

  /**
   * Who runs this hub, and how to reach them. Both are printed on the legal
   * pages, which the server renders; these getters are for the places that
   * name the operator OUTSIDE a document. Empty string when a hub has not
   * said, so a caller can test truthiness and leave the sentence out rather
   * than render "contact ".
   */
  get operator_name(): string {
    return setting("legal.operator_name") ?? "";
  },

  get contact_email(): string {
    return setting("legal.contact_email") ?? "";
  },

  /**
   * REMOVED in Phase 1 part two: `demo_mode` and `demo_bypass_code`.
   *
   * A demo hub is now a `beta.demo_mode` settings row, read only on the
   * server, and it accepts any six digits — so there is no code for the
   * client to hold, display or leak. The sign-in screen shows whatever the
   * server's response says instead of a value compiled into this bundle.
   *
   * Do not reintroduce either of these. A sign-in bypass that ships in the
   * client is readable by anyone who views source.
   */

  get beta_mode(): boolean {
    const served = setting("beta.enabled");
    if (served !== undefined) return served === "true";
    return import.meta.env.VITE_BETA_MODE === "true";
  },

  /**
   * Polis deliberation instance. When non-empty the Conversations nav item
   * appears and /deliberations shows the conversations list.
   */
  get polis_url(): string {
    return (
      setting("plugin.conversation.polis_url") ??
      env(import.meta.env.VITE_HUB_POLIS_URL) ??
      "https://polis.civic.social"
    );
  },

  get onboarding_wordcloud_id(): string {
    return (
      setting("plugin.wordcloud.onboarding_id") ??
      env(import.meta.env.VITE_HUB_ONBOARDING_WORDCLOUD_ID) ??
      ""
    );
  },
};

export default hub;
