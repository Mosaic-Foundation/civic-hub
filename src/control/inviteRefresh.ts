// A used or expired invite link, mended on the start page (pilot readiness 3,
// Adam 2026-11-06). The page says what happened in plain words and, while the
// invite is still good, offers one button, "Send me a fresh link": a new
// single-use link for the same invite, emailed to the same address. Nothing
// here can send to any other address, so holding the old link is enough.
//
// Rate-limited per invite: one a minute, three a day (checkFreshLinkLimit).
// An invite that made its hub points to that hub's sign-in; one that ended
// points to contact@civic.social.

import {
  EntitlementError,
  checkFreshLinkLimit,
  createInviteLink,
  inviteLinkState,
  type InviteLinkLookup,
  type InviteLinkState,
} from "./entitlements.js";
import { hubSignInUrl } from "./inHub.js";
import { renderInviteEmail } from "./inviteEmail.js";
import { mailConfigured, sendEmail, unsentReason } from "../utils/email.js";
import { PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";

/** What the start page shows for a link that can't be followed. */
export interface RefusedLink {
  error: string;
  link_state: Exclude<InviteLinkState, "good">;
  /** The address a fresh link would go to (spent or expired only). */
  email: string | null;
  /** The hub's sign-in page (redeemed only, when the hub is known). */
  hub_url: string | null;
}

/** Can a fresh link be sent for a link in this state? */
export function canRefresh(state: InviteLinkState): boolean {
  return state === "spent" || state === "expired";
}

export async function describeRefusedLink(lookup: InviteLinkLookup): Promise<RefusedLink> {
  const contact = `write to ${PLATFORM_CONTACT_EMAIL}`;
  switch (lookup.state) {
    case "spent":
      return {
        error: `This link has already been used. Your invite is still good, so we can email a fresh link to ${lookup.email}.`,
        link_state: "spent",
        email: lookup.email,
        hub_url: null,
      };
    case "expired":
      return {
        error: `This link has expired. Your invite is still good, so we can email a fresh link to ${lookup.email}.`,
        link_state: "expired",
        email: lookup.email,
        hub_url: null,
      };
    case "redeemed":
      return {
        error: "This invite has already been used to create a hub. Sign in to it there.",
        link_state: "redeemed",
        email: null,
        hub_url: lookup.hub_id ? await hubSignInUrl(lookup.hub_id).catch(() => null) : null,
      };
    case "ended":
      return { error: `This invite has ended. To ask for a new one, ${contact}.`, link_state: "ended", email: null, hub_url: null };
    default:
      return {
        error: `That link can't be used. Check that you opened the whole link from the email, or ${contact}.`,
        link_state: "unknown",
        email: null,
        hub_url: null,
      };
  }
}

/**
 * Send a fresh link for the invite this one belongs to, to the address this
 * one went to. Refused, with the page's words, when the link still works, the
 * invite can't be refreshed, or the limit is reached.
 */
export async function sendFreshInviteLink(token: unknown, startHost: string): Promise<{ sent_to: string; entitlement_id: string }> {
  const lookup = await inviteLinkState(token);
  if (lookup.state === "good") throw new EntitlementError("This link still works. Open it again to continue.", 409);
  if (!canRefresh(lookup.state) || !lookup.entitlement || !lookup.email) {
    throw new EntitlementError((await describeRefusedLink(lookup)).error, 403);
  }
  await checkFreshLinkLimit(lookup.entitlement.id);
  const link = await createInviteLink(lookup.entitlement, lookup.email, { refreshed: true });
  const result = await sendEmail({
    to: lookup.email,
    ...renderInviteEmail({ startHost, linkToken: link.token, email: lookup.email, expiresAt: link.expiresAt }),
  });
  if (!result.sent) {
    console.warn(`[start] fresh invite link NOT sent (${unsentReason(result)}).`);
    // As the console's send: with no mailer at all (local development) it counts as sent.
    if (mailConfigured()) throw new EntitlementError(`The email could not be sent. Try again in a minute, or write to ${PLATFORM_CONTACT_EMAIL}.`, 502);
  }
  return { sent_to: lookup.email, entitlement_id: lookup.entitlement.id };
}
