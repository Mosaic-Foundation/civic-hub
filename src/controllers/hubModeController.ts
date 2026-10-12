// Changing a hub's lifecycle mode.
//
// Two steps on purpose. Moving a hub between beta and live changes who may
// sign in at all, so it is not something an open admin tab should be able to
// do by itself: the caller has to prove, right now, that they hold the
// mailbox. The rule lives in controllers/adminStepUp.ts, shared with the
// admin roster, which needs the same proof for the same reason.
//
//   POST /admin/hub/mode/request-code   emails the caller a code
//   POST /admin/hub/mode                { mode, code } applies the change
//
// LEAVING DEMO ENDS THE HUB'S DEMO SESSIONS (Audit 2): a trigger on `hubs`
// (20261011100000) deletes every session signed in on demo's any six digits,
// so they end the moment the mode changes, on every server. Sessions proved by
// an emailed code, the admin's own among them, carry on.
//
// WHAT CANNOT BE DONE HERE AT ALL: moving a hub into demo. Demo is the one
// mode that relaxes sign-in, and it is set when a hub is created, by the
// control plane. A trigger on `hubs` refuses the update as well, so this
// check is the readable error rather than the only defence.

import { NotFoundError, UnauthorizedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { setHubMode } from "../db/hubs.js";
import { hubModeChangeRejectionReason } from "../models/hub.js";
import { hubModeFor } from "../services/hubSettings.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";
import { recordHubAdminAudit } from "../services/hubAdminAudit.js";
import { removeSampleContent } from "../services/sampleContent.js";

// Kept as an export under its old name: the route and its tests have used it
// since the hardening pass, and it is now the shared step-up handler.
export { handleRequestStepUpCode as handleRequestModeChangeCode } from "./adminStepUp.js";

export const handleSetHubMode = route(async (req, res) => {
  const hub = req.hub;
  const user = caller(res);
  if (!hub) throw new NotFoundError("No civic hub is configured at this address.", "no_hub");
  if (!user) throw new UnauthorizedError("Authentication required");

  const body = req.body as { mode?: unknown; code?: unknown; remove_sample_content?: unknown };

  // The requested mode is checked BEFORE the code is spent. A code is
  // single-use, so an admin who asks for something the rules forbid should
  // not also have to go and fetch another one.
  const rejection = hubModeChangeRejectionReason(hubModeFor(hub), body.mode);
  if (rejection) throw new ValidationError(rejection, "mode_change_rejected");

  // Then prove the mailbox, before anything is written.
  await requireStepUpCode(req, res, body.code);

  const mode = body.mode as string;
  const from = hubModeFor(hub);

  // The trigger on `hubs` that refuses any move into demo is only a backstop:
  // hubModeChangeRejectionReason above already answers that as a plain
  // ValidationError, so a database refusal here is unexpected (generic 500).
  //
  // Graduating out of demo asks whether to take the sample content out
  // (Phase 7); the admin's answer rides along with the same code. Removal
  // first, so a hub that asked for both never goes live with it.
  let removedSample: unknown = null;
  if (body.remove_sample_content === true && from === "demo" && mode !== "demo") {
    removedSample = (await removeSampleContent(user.email)).summary;
  }
  await setHubMode(hub.id, mode);
  await recordHubAdminAudit({
    actor: user.email,
    action: "hub.mode",
    before: { mode: from },
    after: { mode, ...(removedSample ? { removed_sample_content: true } : {}) },
  });

  console.log(`[hub] mode changed: ${hub.id} ${from} -> ${mode} by ${user.email}`);
  res.json({ hub_id: hub.id, mode });
});
