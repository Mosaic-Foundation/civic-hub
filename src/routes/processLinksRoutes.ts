// Light process-linking routes.
//
// Mounted on /process, so every process — of every type, now and later —
// carries these endpoints without any per-type registration.
//
//   GET    /process/link-candidates      typeahead (must precede /:id)
//   GET    /process/:id/links            public, both directions
//   POST   /process/:id/links            creator or admin
//   DELETE /process/:id/links/:linkId    creator or admin

import { Router } from "express";
import {
  handleCreateLink,
  handleDeleteLink,
  handleGetLinks,
  handleLinkCandidates,
} from "../controllers/processLinksController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Signed-in users only — the typeahead enumerates processes, so it is not an
// anonymous discovery surface. Declared before /:id/links so the literal path
// isn't captured as an :id.
router.get("/link-candidates", requireAuth, handleLinkCandidates);

router.get("/:id/links", handleGetLinks);
router.post("/:id/links", requireAuth, handleCreateLink);
router.delete("/:id/links/:linkId", requireAuth, handleDeleteLink);

export default router;
