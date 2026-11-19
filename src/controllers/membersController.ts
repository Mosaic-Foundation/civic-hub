// "Share this hub" (members and invites slice, 2026-10-14).
//
// POST /members/invites   a member's email invites
//
// The count, the faces and the Members page are the Members plugin's
// (features/members, kernel step 4). No answer here carries an email address.

import { route } from "../http/route.js";
import { getActor, getAuthUser } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { cleanMessage, parseAddresses, sendMemberInvites } from "../services/hubInvites.js";

export const handleSendInvites = route(async (req, res) => {
  const user = getAuthUser(res);
  const body = (req.body ?? {}) as { emails?: unknown; message?: unknown };
  const addresses = parseAddresses(body.emails);
  const message = cleanMessage(body.message);
  // An admin's larger limit and allow-list rights need a code-proved session,
  // as every admin power does (requireAdmin); the seam's admin answer asks both.
  const isAdmin = await can(getActor(res), "hub.see_as_admin");
  res.json(
    await sendMemberInvites({ id: user.id, email: user.email, full_name: user.full_name, isAdmin }, addresses, message),
  );
});
