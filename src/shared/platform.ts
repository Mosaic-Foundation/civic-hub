// The platform's own values: what a hub falls back to before it has said
// its own. Not settings — a hub overrides each with its own setting.
//
// Shared by the server and the hub UI. Pure.

/**
 * Where to write when a hub has not given its own contact address
 * (`legal.contact_email`): the legal pages, About, sign-in emails.
 */
export const PLATFORM_CONTACT_EMAIL = "contact@civic.social";

/**
 * The banner every new hub starts with (Adam, 2026-10-08): a crowd in an
 * unnamed square, no landmark, sign or flag, so it makes no claim about any
 * place. Create hub writes it as the hub's own `identity.banner_url`, so the
 * admin replaces or removes it in Settings like any banner; a hub made
 * before it, or one that cleared it, shows none. Shipped in ui/public/ (a
 * root-relative path, which the image validator accepts).
 */
export const DEFAULT_HUB_BANNER = {
  url: "/hub-banner-default.webp",
  alt: "People of all ages gathered in a public square",
} as const;
