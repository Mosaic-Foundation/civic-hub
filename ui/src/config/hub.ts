/**
 * Hub branding config — read at build time from VITE_HUB_* env vars,
 * with Floyd County defaults baked in. This lets a single codebase
 * power multiple Vercel projects (Floyd production, civic.social
 * demo, future per-county hubs) without per-deployment branches:
 * the same `main` build serves everywhere; each Vercel project
 * sets its own VITE_HUB_* values and gets its own branding.
 *
 * Add a new field by extending the `hub` object below and the
 * VITE_HUB_* env-var read above it. Keep the Floyd default
 * accurate so production deployments without overrides keep
 * working.
 *
 * NOT an env-driven concern (these stay code-side):
 *   - Theme colors / fonts (use a separate VITE_HUB_THEME flag and
 *     CSS variable overrides if/when that's needed).
 *   - Legal copy (lives in /content/legal/*.md; see LegalPage.tsx).
 *   - Per-page UI copy that's intrinsically Floyd-civic-specific
 *     (e.g. About-page content describing the hub's mission).
 */

const hub = {
  /**
   * Display name / wordmark — appears in the top-nav, footer,
   * intro popup, settings, search header, etc. Not the geographic
   * jurisdiction.
   */
  name: import.meta.env.VITE_HUB_NAME ?? "Floyd Civic Hub",
  /**
   * Geographic jurisdiction — appears on the banner / hub-info
   * card and in residency-affirmation copy. The "place this hub
   * serves." Stays accurate to the actual served community even
   * when `name` is rebranded for demo / white-label use.
   */
  jurisdiction:
    import.meta.env.VITE_HUB_JURISDICTION ?? "Floyd County, Virginia",
  /**
   * Type label — small caps under the jurisdiction on the banner.
   */
  label: import.meta.env.VITE_HUB_LABEL ?? "Civic Hub",
  /**
   * One-sentence tagline rendered under the jurisdiction.
   */
  tagline:
    import.meta.env.VITE_HUB_TAGLINE ??
    "Stay informed on Floyd County government, raise the issues that matter, work on projects together, and see where our community stands.",
  /**
   * Banner image path. Relative to the deployment root — drop new
   * banner files into `civic-hub/ui/public/` and point this var at
   * their path. Free-tier deploys get same domain/CDN, so /demo-
   * banner.jpg works.
   */
  banner_url: import.meta.env.VITE_HUB_BANNER_URL ?? "/floyd-banner.jpg",
  /**
   * Alt text for the banner — also used in og:image:alt.
   */
  banner_alt:
    import.meta.env.VITE_HUB_BANNER_ALT ??
    "Downtown Floyd, Virginia — the Floyd Civic Hub",
  /**
   * Slice 19a — governance terminology. Per-jurisdiction copy for
   * the elected body that votes are delivered to and whose meetings
   * get summarized. Floyd's BoS is "Board of Supervisors"; a town
   * demo's might be "Town Council"; a city might be "City Council."
   *
   * `governing_body_name` is the long form (delivered-to text, admin
   * pages); `governing_body_short` is the abbreviation used in pills
   * and filter labels where width matters.
   */
  governing_body_name:
    import.meta.env.VITE_HUB_GOVERNING_BODY_NAME ??
    "Board of Supervisors",
  governing_body_short:
    import.meta.env.VITE_HUB_GOVERNING_BODY_SHORT ?? "BOS",
  /**
   * Welcome-popup body and AuthModal residency-intro copy. These are
   * jurisdiction-specific freeform strings that don't generalize via
   * a templating placeholder, so they're full-body env-overridable.
   */
  intro_body:
    import.meta.env.VITE_HUB_INTRO_BODY ??
    "This is where Floyd County residents keep up with county government, raise topics that matter, help make sense of issues together, and have conversations to see where our community stands.",
  residency_intro:
    import.meta.env.VITE_HUB_RESIDENCY_INTRO ??
    "To participate in the Floyd Civic Hub, please confirm your residency and review the policies below.",
  /**
   * When true, the UI shows demo-specific affordances (e.g. the
   * bypass-code hint on the sign-in modal). Set only on demo/preview
   * Vercel projects — NEVER on production deployments.
   */
  demo_mode: import.meta.env.VITE_DEMO_MODE === "true",
  demo_bypass_code: import.meta.env.VITE_DEMO_BYPASS_CODE ?? "",
  beta_mode: import.meta.env.VITE_BETA_MODE === "true",
  /**
   * Polis deliberation instance URL. When non-empty, the
   * "Conversations" nav item appears and the /deliberations route
   * shows the conversations list. Set to "" to disable.
   */
  polis_url: import.meta.env.VITE_HUB_POLIS_URL ?? "https://polis.civic.social",
  onboarding_wordcloud_id:
    import.meta.env.VITE_HUB_ONBOARDING_WORDCLOUD_ID ?? "",
};

export default hub;
