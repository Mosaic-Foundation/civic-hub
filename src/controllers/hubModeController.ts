// Changing a hub's lifecycle mode.
//
// Two steps on purpose. Moving a hub between beta and live changes who may
// sign in at all, so it is not something an open admin tab should be able to
// do by itself: the caller has to prove, right now, that they hold the
// mailbox. That is the same one-time code the sign-in flow uses, checked by
// the same function, so the lockout, the expiry and the single-use rule are
// not reimplemented here in a weaker form.
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
import { requestVerification, consumePendingCode } from "../modules/civic.auth/index.js";
import { hubModeChangeRejectionReason } from "../models/hub.js";
import { hubModeFor } from "../services/hubSettings.js";
import type { User } from "../modules/civic.auth/index.js";

function caller(res: Response): User | undefined {
  return res.locals.authUser as User | undefined;
}

/**
 * Send the caller a fresh code for a mode change.
 *
 * Reuses the ordinary sign-in request, which already throttles, respects the
 * lockout, and — because an admin is a privileged account — always sends a
 * real email even on a demo hub.
 */
export async function handleRequestModeChangeCode(
  _req: Request,
  res: Response,
): Promise<void> {
  const user = caller(res);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    await requestVerification(user.email);
    res.json({
      message: `A confirmation code has been sent to ${user.email}.`,
    });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

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
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    res.status(400).json({
      error:
        "A confirmation code is required. Request one, then submit it with the new mode.",
    });
    return;
  }

  const rejection = hubModeChangeRejectionReason(hubModeFor(hub), body.mode);
  if (rejection) {
    res.status(400).json({ error: rejection });
    return;
  }
  const mode = body.mode as string;

  // Prove the mailbox BEFORE touching anything. A wrong code here counts
  // toward the same lockout as a wrong sign-in code.
  try {
    await consumePendingCode(user.email, code);
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
    return;
  }

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
