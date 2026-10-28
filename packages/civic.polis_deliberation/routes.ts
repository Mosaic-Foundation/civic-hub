import { Router } from "express";
import { requireResident, requireAdmin } from "@civic-social/plugin-sdk/first-party";
import * as ctrl from "./controller.js";

const router = Router();

// Public — list and detail
router.get("/", ctrl.listDeliberations);
router.get("/:processId", ctrl.getDeliberation);

// Public — cluster state (no auth needed to view opinion groups)
router.get("/:processId/clusters", ctrl.getClusterState);

// Participation — requires authenticated resident
router.post("/:processId/participate/vote", requireResident, ctrl.vote);
router.post("/:processId/participate/statement", requireResident, ctrl.submitStatement);
router.get("/:processId/participate/next", requireResident, ctrl.getNextStatement);

// Create — residents submit for review, admins create directly
router.post("/", requireResident, ctrl.handleCreateDeliberation);
router.post("/:processId/start", requireAdmin, ctrl.handleStartDeliberation);
router.post("/:processId/close", requireAdmin, ctrl.closeDeliberation);
router.post("/:processId/regenerate", requireAdmin, ctrl.regenerateSummary);

export default router;
