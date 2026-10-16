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
import { forHub } from "../db/forHub.js";
import { KEYS, KEY_ALIASES } from "../models/hubSettings.js";
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

/** The settings rows that make an address privileged (and their legacy keys). */
const PRIVILEGE_KEYS = [
  KEYS.PEOPLE_ADMIN_EMAILS,
  KEYS.PEOPLE_BOARD_EMAILS,
  KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS,
  KEY_ALIASES[KEYS.PEOPLE_ANNOUNCEMENT_AUTHORS]!,
];

/**
 * isPrivilegedEmail, read from the database now rather than from the
 * request's settings snapshot (Audit 2).
 *
 * The snapshot was up to a minute old on a serverless instance until the
 * settings version (20261018000000), and still is where the version can't be
 * read, so an address an admin has just added could sign in on a demo hub's
 * any six digits there. Such a session could never pass an admin check (it is a
 * demo session), and it reads as signed out once the snapshot catches up; but
 * sign-in is rare enough to read the lists fresh, so the window does not
 * exist at all. Every address-shaped string in the rows counts, as in the
 * database trigger, whatever the row's shape. Fails closed.
 */
export async function isPrivilegedEmailNow(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const hubId = currentHubIdOrNull();
  if (!hubId) return isPrivilegedEmail(normalized);
  try {
    const rows = await forHub(hubId)
      .from("hub_settings")
      .select<{ value: string }>("value")
      .in("key", PRIVILEGE_KEYS);
    for (const row of rows) {
      const found: string[] = String(row.value).toLowerCase().match(/[^\][\s",;{}:<>]+@[^\][\s",;{}:<>]+/g) ?? [];
      if (found.includes(normalized)) return true;
    }
    return (await lookupOfficialByEmail(normalized)) !== null;
  } catch (e) {
    console.error(
      `[auth] fresh privilege check failed for ${normalized}, treating as privileged: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return true;
  }
}
