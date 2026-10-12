import { ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import {
  getAdminQueueCounts,
  isAdminQueue,
  markAdminQueueSeen,
  ADMIN_QUEUES,
} from "../services/adminQueues.js";

/** GET /admin/queue-counts — the numbers on the admin tabs. */
export const handleAdminQueueCounts = route(async (_req, res) => {
  res.json(await getAdminQueueCounts(getAuthUser(res).id));
});

/** POST /admin/queues/:queue/seen — opening a tab clears its count. */
export const handleMarkAdminQueueSeen = route(async (req, res) => {
  const queue = req.params.queue;
  if (!isAdminQueue(queue)) {
    throw new ValidationError(`Unknown queue. Expected one of: ${ADMIN_QUEUES.join(", ")}.`);
  }
  await markAdminQueueSeen(getAuthUser(res).id, queue);
  res.json({ ok: true });
});
