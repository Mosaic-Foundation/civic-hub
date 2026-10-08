// The platform's own values: what a hub falls back to before it has said
// its own. Not settings — a hub overrides each with its own setting.
//
// Shared by the server and the hub UI. Pure.

/**
 * Where to write when a hub has not given its own contact address
 * (`legal.contact_email`): the legal pages, About, sign-in emails.
 */
export const PLATFORM_CONTACT_EMAIL = "contact@civic.social";
