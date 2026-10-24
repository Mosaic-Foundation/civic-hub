// Admin feedback controller — the read side of civic.feedback.
//
// GET /admin/feedback is the operator's archive of everything residents
// have sent through the feedback form. Read-only by design: there is no
// approve, edit, or delete. Feedback is a record of what someone said,
// and an archive you can edit is a worse record than one you cannot.
//
// PII: these rows carry name and email. requireAdmin (mounted on the
// whole /admin router) is what stands between them and the world — this
// endpoint is the first path by which feedback leaves the database.

import { UnauthorizedError } from "../errors/index.js";
import { route } from "../http/route.js";
import { contactMosaic, forwardToMosaic, listFeedback } from "../modules/civic.feedback/index.js";
import type { FeedbackCategory, MosaicHubStream } from "../modules/civic.feedback/index.js";
import { auditActor, recordHubAdminAudit } from "../services/hubAdminAudit.js";
import { caller } from "./adminStepUp.js";

// --- GET /admin/feedback ----------------------------------------------------

export const handleAdminListFeedback = route(async (req, res) => {
  const rawCategory = req.query.category;
  const category =
    typeof rawCategory === "string" && rawCategory !== "" && rawCategory !== "all"
      ? (rawCategory as FeedbackCategory)
      : undefined;

  const rawLimit = req.query.limit;
  const parsedLimit =
    typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  const items = await listFeedback({ category, limit });
  res.json({ items, count: items.length });
});

// --- POST /admin/feedback/:id/forward ---------------------------------------
//
// "Send to Civic.Social": the one write on this archive. It changes nothing
// the resident said; it shares the item with Civic.Social, in the stream the
// admin picks, without the sender's address. Recorded in the admin log.

export const handleForwardFeedback = route(async (req, res) => {
  const user = caller(res);
  if (!user) throw new UnauthorizedError("Sign in as an admin.");
  const stream = (req.body as Record<string, unknown> | undefined)?.stream as MosaicHubStream;
  const item = await forwardToMosaic(String(req.params.id), stream);
  await recordHubAdminAudit({
    actor: auditActor(user),
    action: "feedback.forward",
    after: { id: item.id, category: item.category, stream },
  });
  res.json({ item });
});

// --- POST /admin/contact-civic-social ---------------------------------------
//
// A hub admin writes to Civic.Social directly. Not behind the Feedback
// plugin: an admin can always reach the people who maintain the software.

export const handleContactCivicSocial = route(async (req, res) => {
  const user = caller(res);
  if (!user) throw new UnauthorizedError("Sign in as an admin.");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ua = req.headers["user-agent"];
  const { id } = await contactMosaic({
    message: body.message,
    adminEmail: user.email,
    pagePath: body.page_path,
    userAgent: typeof ua === "string" ? ua : null,
  });
  res.json({ id, message: "Sent to Civic.Social." });
});
