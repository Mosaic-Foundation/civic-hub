// Who counts as privileged, for the purposes of relaxing sign-in.
//
// A demo hub lets a visitor in with any six digits so they can look around
// without an inbox. That relaxation must never extend to an account that can
// act on the hub: an admin, or an official whose name appears on published
// announcements. If it did, "sign in as anyone" would include signing in as
// the people running the place, and on a hub that later graduates out of demo
// those accounts would already have been impersonable.
//
// Deliberately generous about what counts. The cost of treating an ordinary
// visitor as privileged is that they receive a real email; the cost of the
// reverse is an impersonated admin. When in doubt, require the code.

import { getAdminEmailsSync, getBoardEmailsSync } from "./hubSettings.js";
import { getAnnouncementAuthors } from "./hubSettings.js";
import { currentHubIdOrNull } from "../config/hubContext.js";
import { lookupOfficialByEmail } from "./officials.js";

/**
 * Does this email belong to someone who can act on the hub?
 *
 * Checks the admin roster, the board roster, the announcement-author list and
 * the managed officials table. Any hit means the real emailed code is
 * required, whatever mode the hub is in.
 *
 * Fails CLOSED: if any lookup throws, the answer is "privileged", so a
 * database wobble makes sign-in stricter rather than looser.
 */
export async function isPrivilegedEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  try {
    if (getAdminEmailsSync().includes(normalized)) return true;
    if (getBoardEmailsSync().includes(normalized)) return true;

    const hubId = currentHubIdOrNull();
    const authors = await getAnnouncementAuthors(hubId);
    if (authors.some((a) => a.email.trim().toLowerCase() === normalized)) {
      return true;
    }

    if (await lookupOfficialByEmail(normalized)) return true;
    return false;
  } catch (e) {
    console.error(
      `[auth] privilege check failed for ${normalized}, treating as privileged: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return true;
  }
}
