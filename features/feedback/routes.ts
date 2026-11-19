// The Feedback plugin's routes (a kernel route until kernel step 4,
// 2026-11-19). Each behind the plugin's switch (the host mounts them so).
//
//   POST /feedback                       send feedback (anyone; honeypot-gated)
//   POST /feedback/screenshot            a screenshot for a bug report (signed in)
//   GET  /admin/feedback                 Admin → Feedback: what residents sent (admins)
//   POST /admin/feedback/:id/forward     "Send to Civic.Social" for one item (admins)
//
// An admin's own "Contact Civic.Social" is the kernel's (/admin/contact-civic-social),
// not this plugin's: it works with Feedback off.

import { Router } from "express";
import {
  getAuthUser,
  imageUpload,
  recordAdminAct,
  requireResident,
  resolveCallerUser,
  route,
  ValidationError,
} from "../../src/sdk/index.js";
import { forwardToMosaic, listFeedback, submitFeedback } from "./service.js";
import type { FeedbackStore } from "./store.js";
import type { FeedbackCategory, MosaicHubStream } from "./models.js";

const MESSAGE_MAX_LEN = 4000;

export function feedbackRoutes(store: FeedbackStore): Router {
  const r = Router();

  // Anonymous or signed in. A signed-in sender's account is kept on the item
  // for triage. The honeypot field `website` silently discards spam: it
  // answers as a real send does, so a bot cannot tell the difference.
  r.post(
    "/",
    route(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.website === "string" && body.website.trim().length > 0) {
        res.json({ message: "Thanks for the feedback." });
        return;
      }
      const message = body.message;
      if (typeof message !== "string" || message.trim().length === 0) throw new ValidationError("message is required");
      if (message.length > MESSAGE_MAX_LEN) throw new ValidationError(`message must be ${MESSAGE_MAX_LEN} characters or fewer`);

      const user = await resolveCallerUser(req);
      const name = typeof body.name === "string" ? body.name : null;
      const email = typeof body.email === "string" ? body.email : null;
      const ua = req.headers["user-agent"];
      const submission = await submitFeedback(store, {
        category: body.category as never, // the service refuses an unknown one
        message,
        name: name || user?.display_name || null,
        email: email || user?.email || null,
        user_id: user?.id ?? null,
        user_agent: typeof ua === "string" ? ua : null,
        screenshot_url: typeof body.screenshot_url === "string" ? body.screenshot_url : null,
        page_path: typeof body.page_path === "string" ? body.page_path : null,
        contact_ok: body.contact_ok === true,
      });
      res.json({
        message: "Thanks for the feedback.",
        submission_id: submission.id,
        // Whether Civic.Social has a copy, so the confirmation can say so.
        shared_with_civic_social: submission.mosaic !== null,
      });
    }),
  );

  // A screenshot on a bug report: the kernel's image upload, same checks and
  // bucket as other images. Signed-in residents only; the form offers the
  // picker only when signed in, and the service refuses a screenshot on an
  // anonymous submission.
  r.post("/screenshot", requireResident, imageUpload);

  return r;
}

/** Under /admin, after the admin check. */
export function adminFeedbackRoutes(store: FeedbackStore): Router {
  const r = Router();

  // The archive: everything residents sent, newest first, optionally one
  // category. Read-only on purpose: feedback is a record of what someone
  // said, and an archive you can edit is a worse record than one you cannot.
  // These rows carry name and email; the admin check is what stands between
  // them and the world.
  r.get(
    "/",
    route(async (req, res) => {
      const raw = req.query.category;
      const category = typeof raw === "string" && raw !== "" && raw !== "all" ? (raw as FeedbackCategory) : undefined;
      const parsed = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
      const items = await listFeedback(store, { category, limit: Number.isFinite(parsed) ? parsed : undefined });
      res.json({ items, count: items.length });
    }),
  );

  // "Send to Civic.Social": the one write on the archive. It changes nothing
  // the resident said; it shares the item with Civic.Social, in the stream
  // the admin picks, without the sender's address. Recorded in the admin log.
  r.post(
    "/:id/forward",
    route(async (req, res) => {
      const user = getAuthUser(res);
      const stream = (req.body as Record<string, unknown> | undefined)?.stream as MosaicHubStream;
      const item = await forwardToMosaic(store, String(req.params.id), stream);
      await recordAdminAct(user, "feedback.forward", { id: item.id, category: item.category, stream });
      res.json({ item });
    }),
  );

  return r;
}
