// Members and "Share this hub" (members and invites slice, 2026-10-14).
//
// GET  /members/summary   "N members" and the avatar stack: everyone
// GET  /members           the Members page: signed-in members only
// POST /members/invites   a member's email invites
// GET  /admin/hub/members Settings → People: the members who hid themselves, and the count
//
// No answer here carries an email address.

import { route } from "../http/route.js";
import { getAuthUser, isAdminEmail } from "../middleware/auth.js";
import type { SessionAssurance } from "../modules/civic.auth/models.js";
import { listMembers, listMembersForAdmin, memberSummary } from "../services/members.js";
import { cleanMessage, parseAddresses, sendMemberInvites } from "../services/hubInvites.js";

export const handleMemberSummary = route(async (_req, res) => {
  res.json(await memberSummary());
});

export const handleListMembers = route(async (req, res) => {
  const user = getAuthUser(res);
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
  // as every admin power does (requireAdmin).
  const isAdmin =
    isAdminEmail(user.email) && (res.locals.authAssurance as SessionAssurance | undefined) === "code";
  res.json(
    await sendMemberInvites({ id: user.id, email: user.email, full_name: user.full_name, isAdmin }, addresses, message),
  );
});

export const handleAdminListMembers = route(async (_req, res) => {
  res.json(await listMembersForAdmin());
});
