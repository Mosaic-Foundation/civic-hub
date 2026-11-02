// The "Set up your hub" card on the home page (pilot readiness 2, 2026-11-02):
// its ticks, from the hub's state, and the two things an admin can press on it,
// stored on their own account. Behind the admin router, as every /admin route.

import { route } from "../http/route.js";
import { ValidationError } from "../errors/index.js";
import { readSetupCardMarks, setSetupCardMark } from "../modules/civic.auth/index.js";
import { setupSteps } from "../services/modeReadiness.js";
import { getAuthUser } from "../middleware/auth.js";

/** GET /admin/hub/setup-card: whether this admin dismissed it, and the steps. */
export const handleGetSetupCard = route(async (_req, res) => {
  const marks = await readSetupCardMarks(getAuthUser(res).id);
  res.json({ dismissed: marks.dismissed, steps: await setupSteps(marks.skippedSecondAdmin) });
});

/** POST /admin/hub/setup-card { action: "dismiss" | "skip_second_admin" }. */
export const handlePostSetupCard = route(async (req, res) => {
  const action = (req.body ?? {}).action;
  if (action !== "dismiss" && action !== "skip_second_admin") {
    throw new ValidationError('Body must be { action: "dismiss" | "skip_second_admin" }.');
  }
  const userId = getAuthUser(res).id;
  await setSetupCardMark(userId, action);
  const marks = await readSetupCardMarks(userId);
  res.json({ dismissed: marks.dismissed, steps: await setupSteps(marks.skippedSecondAdmin) });
});
