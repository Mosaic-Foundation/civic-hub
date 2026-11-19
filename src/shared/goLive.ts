// Going live needs the platform's approval (Adam, 2026-11-19).
//
// A live hub runs under an agreement with Civic.Social, so a hub's own admins
// may move it to live only after the platform operator has approved it in the
// console (hubs.live_approved_at, migration 20261119000000). Shared by the
// server's refusal and the Hub settings page, so both say the same thing.

/** Where a hub's admins write to ask for live. */
export const GO_LIVE_CONTACT_EMAIL = "adam@civic.social";

/** Said wherever going live is refused or shown as unavailable. */
export const GO_LIVE_UNAVAILABLE_MESSAGE =
  `Going live isn't available yet. Live hubs run under an agreement with Civic.Social. To take this hub live, email ${GO_LIVE_CONTACT_EMAIL}.`;
