import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  getAdminQueueCounts,
  isAdminQueue,
  markAdminQueueSeen,
  ADMIN_QUEUES,
} from "../services/adminQueues.js";

/** GET /admin/queue-counts — the numbers on the admin tabs. */
export async function handleAdminQueueCounts(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await getAdminQueueCounts(getAuthUser(res).id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** POST /admin/queues/:queue/seen — opening a tab clears its count. */
export async function handleMarkAdminQueueSeen(req: Request, res: Response): Promise<void> {
  const queue = req.params.queue;
  if (!isAdminQueue(queue)) {
    res.status(400).json({ error: `Unknown queue. Expected one of: ${ADMIN_QUEUES.join(", ")}.` });
    return;
  }
  try {
    await markAdminQueueSeen(getAuthUser(res).id, queue);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
