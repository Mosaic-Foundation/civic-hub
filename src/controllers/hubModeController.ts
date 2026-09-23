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
// WHAT CANNOT BE DONE HERE AT ALL: moving a hub into demo. Demo is the one
// mode that relaxes sign-in, and it is set when a hub is created, by the
// control plane. A trigger on `hubs` refuses the update as well, so this
// check is the readable error rather than the only defence.

import type { Request, Response } from "express";
import { getDb } from "../db/client.js";
import { invalidateHubCache } from "../db/hubs.js";
import { hubModeChangeRejectionReason } from "../models/hub.js";
import { hubModeFor } from "../services/hubSettings.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";

// Kept as an export under its old name: the route and its tests have used it
// since the hardening pass, and it is now the shared step-up handler.
export { handleRequestStepUpCode as handleRequestModeChangeCode } from "./adminStepUp.js";

export async function handleSetHubMode(
  req: Request,
  res: Response,
): Promise<void> {
  const hub = req.hub;
  const user = caller(res);
  if (!hub) {
    res.status(404).json({ error: "no_hub" });
    return;
  }
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = req.body as { mode?: unknown; code?: unknown };

  // The requested mode is checked BEFORE the code is spent. A code is
  // single-use, so an admin who asks for something the rules forbid should
  // not also have to go and fetch another one.
  const rejection = hubModeChangeRejectionReason(hubModeFor(hub), body.mode);
  if (rejection) {
    res.status(400).json({ error: rejection });
    return;
  }

  // Then prove the mailbox, before anything is written.
  if (!(await requireStepUpCode(res, body.code))) return;

  const mode = body.mode as string;

  const { error } = await getDb()
    .from("hubs")
    .update({ mode })
    .eq("id", hub.id);

  if (error) {
    // The trigger refuses any move into demo. Surface it as the rule it is
    // rather than as a database error.
    const message = /demo mode/i.test(error.message)
      ? "A hub cannot be moved into demo mode. Demo is set when the hub is created."
      : error.message;
    res.status(400).json({ error: message });
    return;
  }

  invalidateHubCache();
  console.log(
    `[hub] mode changed: ${hub.id} ${hubModeFor(hub)} -> ${mode} by ${user.email}`,
  );
  res.json({ hub_id: hub.id, mode });
}
