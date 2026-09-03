import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { listEditNotifications, markEditsSeen } from "../services/editNotifications.js";

/** GET /notifications/edits — signed in. Edited processes this user supports, since last seen. */
export async function handleGetEditNotifications(_req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const items = await listEditNotifications(user.id);
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
