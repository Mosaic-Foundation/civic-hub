// About you routes (districts and demographics, 2026-11-16) — requireAuth:
// a member reads and writes only their own answers. See
// src/controllers/aboutController.ts.

import { Router } from "express";
import { handleAboutAsked, handleAddressSuggestions, handleDistrictLookup, handleGetAbout, handlePutAbout } from "../controllers/aboutController.js";
import { requireAuth } from "../middleware/auth.js";

export const aboutRouter = Router();
aboutRouter.get("/", requireAuth, handleGetAbout);
aboutRouter.put("/", requireAuth, handlePutAbout);
aboutRouter.post("/asked", requireAuth, handleAboutAsked);
aboutRouter.post("/district-lookup", requireAuth, handleDistrictLookup);
aboutRouter.post("/address-suggestions", requireAuth, handleAddressSuggestions);
