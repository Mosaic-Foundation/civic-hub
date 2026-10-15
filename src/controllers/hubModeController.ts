// Changing a hub's lifecycle mode.
//
// Two steps on purpose. Moving a hub between beta and live changes who may
// sign in at all, so it is not something an open admin tab should be able to
// do by itself: the caller has to prove, right now, that they hold the
// mailbox. The rule lives in controllers/adminStepUp.ts, shared with the
// admin roster, which needs the same proof for the same reason.
//
//   GET  /admin/hub/mode/readiness?to=  what must be in place, and what the
//                                        switch will do (services/modeReadiness.ts)
//   POST /admin/hub/mode/request-code   emails the caller a code
//   POST /admin/hub/mode                { mode, code, accepted?, remove_sample_content?,
//                                        tell_waitlist? } applies the change
//
// READINESS (leaving-demo slice, 2026-10-15). A move up (out of demo, or beta
// to live) goes ahead only when every readiness item is done or, where it may
// be, accepted in `accepted`. The time zone and postal address can't be
// accepted. Checked before the code is spent, like the mode itself, and the
// accepted items are written into the admin log entry.
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
import { hubModeChangeRejectionReason, type HubMode } from "../models/hub.js";
import { hubModeFor } from "../services/hubSettings.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";
import { recordHubAdminAudit } from "../services/hubAdminAudit.js";
import { removeSampleContent } from "../services/sampleContent.js";
import { modeReadiness, readinessRefusal } from "../services/modeReadiness.js";
import { tellWaitlistHubIsOpen } from "../services/waitlistOpen.js";
import { isHubMode } from "../models/hub.js";

export const handleGetModeReadiness = route(async (req, res) => {
  if (!req.hub) throw new NotFoundError("No civic hub is configured at this address.", "no_hub");
  const to = req.query.to;
  if (!isHubMode(to)) throw new ValidationError(`"${String(to)}" is not a hub mode.`, "invalid_mode");
  res.json(await modeReadiness(to));
});

// Kept as an export under its old name: the route and its tests have used it
// since the hardening pass, and it is now the shared step-up handler.
export { handleRequestStepUpCode as handleRequestModeChangeCode } from "./adminStepUp.js";

export const handleSetHubMode = route(async (req, res) => {
  const hub = req.hub;
  const user = caller(res);
  if (!hub) throw new NotFoundError("No civic hub is configured at this address.", "no_hub");
  if (!user) throw new UnauthorizedError("Authentication required");

  const body = req.body as {
    mode?: unknown;
    code?: unknown;
    remove_sample_content?: unknown;
    accepted?: unknown;
    tell_waitlist?: unknown;
  };

  // The requested mode is checked BEFORE the code is spent. A code is
  // single-use, so an admin who asks for something the rules forbid should
  // not also have to go and fetch another one.
  const rejection = hubModeChangeRejectionReason(hubModeFor(hub), body.mode);
  if (rejection) throw new ValidationError(rejection, "mode_change_rejected");

  const mode = body.mode as HubMode;
  const from = hubModeFor(hub);
  const accepted = Array.isArray(body.accepted) ? body.accepted.filter((a): a is string => typeof a === "string") : [];
  const removeSamples = body.remove_sample_content === true && from === "demo" && mode !== "demo";
  const readiness = await modeReadiness(mode);
  const notReady = readinessRefusal(readiness.items, accepted, removeSamples);
  if (notReady) throw new ValidationError(notReady, "mode_not_ready");
  // Only the items that were open: an acceptance of something already done
  // says nothing.
  const acceptedOpen = readiness.items.filter((i) => !i.done && accepted.includes(i.id)).map((i) => i.id);

  // Then prove the mailbox, before anything is written.
  await requireStepUpCode(req, res, body.code);

  // The trigger on `hubs` that refuses any move into demo is only a backstop:
  // hubModeChangeRejectionReason above already answers that as a plain
  // ValidationError, so a database refusal here is unexpected (generic 500).
  //
  // Graduating out of demo asks whether to take the sample content out
  // (Phase 7); the admin's answer rides along with the same code. Removal
  // first, so a hub that asked for both never goes live with it.
  let removedSample: unknown = null;
  if (removeSamples) {
    removedSample = (await removeSampleContent(user.email)).summary;
  }
  await setHubMode(hub.id, mode);
  await recordHubAdminAudit({
    actor: user.email,
    action: "hub.mode",
    before: { mode: from },
    after: {
      mode,
      ...(removedSample ? { removed_sample_content: true } : {}),
      ...(acceptedOpen.length > 0 ? { accepted: acceptedOpen } : {}),
    },
  });

  // The waitlist was promised an email when the hub opened (ticked by
  // default on the page; anything but an explicit false tells them).
  let waitlist: { told: number; failed: number } | null = null;
  if (mode === "live" && from !== "live" && body.tell_waitlist !== false) {
    waitlist = await tellWaitlistHubIsOpen();
  }

  console.log(`[hub] mode changed: ${hub.id} ${from} -> ${mode} by ${user.email}`);
  res.json({ hub_id: hub.id, mode, ...(waitlist ? { waitlist } : {}) });
});
