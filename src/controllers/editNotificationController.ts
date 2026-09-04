import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { listAllEdits, listEditNotifications, markEditsSeen } from "../services/editNotifications.js";

/** GET /notifications/edits — signed in. Edited processes this user supports, since last seen. */
export async function handleGetEditNotifications(_req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    // Supporter view for everyone — an admin's overview lives in the admin
    // panel Edits tab (GET /admin/edits), not the account dropdown.
    const items = await listEditNotifications(user.id, false);
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** POST /notifications/edits/seen — clears the badge. */
export async function handleMarkEditsSeen(_req: Request, res: Response): Promise<void> {
  try {
    await markEditsSeen(getAuthUser(res).id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** GET /admin/edits — every edited process (any type), newest first, + unseen count. */
export async function handleAdminListEdits(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await listAllEdits(getAuthUser(res).id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
