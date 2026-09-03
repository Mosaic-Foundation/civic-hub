// civic.digest module — public surface.
//
// A service module — not registered in the process registry. The hub
// wires it in via:
//   - a cron-triggered controller that calls assembleDigestForUser for
//     each subscribed user, then hands the DigestEmail to utils/email
//     (Resend) for delivery
//   - an unsubscribe controller that verifies tokens and sets
//     digest_frequency_days to null via civic.auth.setDigestFrequency
//
// Hubs that don't want a daily digest simply don't wire the controllers
// up — nothing else in the hub depends on this module being loaded.

export type {
  DigestAssemblyInput,
  DigestEmail,
  DigestEvent,
  DigestHubContext,
  DigestItem,
  DigestItemKind,
  DigestUser,
} from "./models.js";

export {
  assembleDigestForUser,
  buildEditItems,
  formatDigestHtml,
  formatDigestText,
} from "./service.js";

export {
  classifyItemKind,
  isDigestRenderable,
  sortDigestItems,
} from "./filter.js";

export {
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} from "./unsubscribe.js";
