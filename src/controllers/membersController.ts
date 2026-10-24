// Members and "Share this hub" (members and invites slice, 2026-10-14).
//
// GET  /members/summary   "N members" and the avatar stack: everyone
// GET  /members           the Members page: signed-in members only
// POST /members/invites   a member's email invites
// GET  /admin/hub/members Settings → People: the members who hid themselves, and the count
//
// No answer here carries an email address.

import { NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import { getActor, getAuthUser, resolveCallerIsAdmin } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { listMembers, listMembersForAdmin, memberSummary, memberVisibility } from "../services/members.js";
import { cleanMessage, parseAddresses, sendMemberInvites } from "../services/hubInvites.js";

// Below the Members plugin's threshold a resident gets no number and no stack
// (`count: null`), so the page cannot show what the server withheld; an admin
// gets both, with the threshold, to see where the hub stands.
export const handleMemberSummary = route(async (req, res) => {
  const summary = await memberSummary();
  const seen = await memberVisibility(summary.count);
  const admin = await resolveCallerIsAdmin(req);
  if (seen.countShown || admin) {
    res.json({ ...summary, shown: seen.countShown, page: seen.pageShown, threshold: admin ? seen.threshold : undefined });
    return;
  }
  res.json({ count: null, stack: [], shown: false, page: seen.pageShown });
});

export const handleListMembers = route(async (req, res) => {
  const user = getAuthUser(res);
  // Before the threshold the page is not there for residents, unless the
  // hub shows it anyway (page_before_threshold); an admin always sees it.
  if (!(await memberVisibility()).pageShown && !(await can(getActor(res), "hub.see_as_admin"))) throw new NotFoundError("Not found");
  const offset = Number(req.query.offset ?? 0);
  res.json({
    ...(await listMembers(Number.isFinite(offset) ? offset : 0)),
    you_are_hidden: user.hidden_from_members,
  });
});

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

export const handleAdminListMembers = route(async (_req, res) => {
  res.json(await listMembersForAdmin());
});
