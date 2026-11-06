// The "Set up your hub" card on the home page (pilot readiness 2, 2026-11-02)
// and the full setup checklist in Hub settings → Getting started (pilot
// readiness 3, 2026-11-06): the ticks, from the hub's state, and the two
// things an admin can press, stored on their own account. Behind the admin
// router, as every /admin route.

import { route } from "../http/route.js";
import { ValidationError } from "../errors/index.js";
import { readSetupCardMarks, setSetupCardMark } from "../modules/civic.auth/index.js";
import { SETUP_CARD_STEPS, setupChecklist } from "../services/modeReadiness.js";
import { getAuthUser } from "../middleware/auth.js";

/**
 * The card and the checklist from one read: `steps` is the card's first few,
 * `checklist` all of them (Hub settings → Getting started, pilot readiness 3).
 */
async function view(userId: string) {
  const marks = await readSetupCardMarks(userId);
  const checklist = await setupChecklist(marks.skippedSecondAdmin);
  return { dismissed: marks.dismissed, steps: checklist.slice(0, SETUP_CARD_STEPS), checklist };
}

/** GET /admin/hub/setup-card: whether this admin dismissed the card, its steps and the whole checklist. */
export const handleGetSetupCard = route(async (_req, res) => {
  res.json(await view(getAuthUser(res).id));
});

/** POST /admin/hub/setup-card { action: "dismiss" | "skip_second_admin" }. */
export const handlePostSetupCard = route(async (req, res) => {
  const action = (req.body ?? {}).action;
  if (action !== "dismiss" && action !== "skip_second_admin") {
    throw new ValidationError('Body must be { action: "dismiss" | "skip_second_admin" }.');
  }
  const userId = getAuthUser(res).id;
  await setSetupCardMark(userId, action);
  res.json(await view(userId));
});
