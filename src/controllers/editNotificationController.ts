import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { listAllEdits, listEditNotifications, markEditsSeen } from "../services/editNotifications.js";

/** GET /notifications/edits — signed in. Edited processes this user supports, since last seen. */
export const handleGetEditNotifications = route(async (_req, res) => {
  const user = getAuthUser(res);
  // Supporter view for everyone — an admin's overview lives in the admin
  // panel Edits tab (GET /admin/edits), not the account dropdown.
  const items = await listEditNotifications(user.id, false);
  res.json({ count: items.length, items });
});

/** POST /notifications/edits/seen — clears the badge. */
export const handleMarkEditsSeen = route(async (_req, res) => {
  await markEditsSeen(getAuthUser(res).id);
  res.json({ ok: true });
});

/** GET /admin/edits — every edited process (any type), newest first, + unseen count. */
export const handleAdminListEdits = route(async (_req, res) => {
  res.json(await listAllEdits(getAuthUser(res).id));
});
