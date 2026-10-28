// Briefs — public read of published civic.brief pages (the universal results
// record for any completed process). Reclaims the /brief path from the Slice
// 8.5 legacy redirect: /brief now serves the generic brief, and the retired
// vote results' records are briefs too (legacyRoutes.ts redirects them).

import { Router } from "express";
import {
  handleGetBrief,
  handleListBriefs,
  handlePostBriefResponse,
} from "./controller.js";
import { requireOfficial } from "@civic-social/plugin-sdk/first-party";

const router = Router();

// The outcomes index. Declared before /:id so the bare path is not captured
// as a brief id.
router.get("/", handleListBriefs);

// Public — no auth required. Returns 404 for unpublished records.
router.get("/:id", handleGetBrief);

// An official's public response to a published brief. requireOfficial is
// the who (an account holding an office); the controller's respondGate is
// the when (published briefs only).
router.post("/:id/response", requireOfficial, handlePostBriefResponse);

export default router;
