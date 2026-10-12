// One router for every drafting kind (Audit 3, F1), mounted at each kind's
// existing path (/proposals/drafts, /votes/drafts, /projects/drafts,
// /deliberations/drafts). Every route needs a resident: the projects router
// used requireAuth for reading and editing, which added nothing (only a
// resident can create a draft, and only its owner can read or edit it).
//
// Assistant conversation and the Code of Conduct check are on the shared
// /assistant routes (assistantRoutes.ts), dispatched on process type.

import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import { draftController } from "../controllers/draftController.js";
import type { DraftKind } from "../processes/draftKinds.js";
import type { BaseDraft } from "../modules/civic.drafts/index.js";

export function draftRouter<D extends BaseDraft>(
  kind: DraftKind<D>,
  /** Routes of this kind's own, added before "/:id" so their paths are not taken for draft ids. */
  extra?: (router: Router) => void,
): Router {
  const handlers = draftController(kind);
  const router = Router();
  router.post("/", requireResident, handlers.create);
  router.get("/", requireResident, handlers.list);
  extra?.(router);
  router.get("/:id", requireResident, handlers.get);
  router.patch("/:id", requireResident, handlers.update);
  router.post("/:id/submit", requireResident, handlers.submit);
  return router;
}
