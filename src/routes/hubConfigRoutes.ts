// GET /hub-config — the resolved hub's public configuration.
//
// Reached as /api/hub-config in production, where vercel.json rewrites /api/*
// to the Express function and api/index.ts strips the prefix before Express
// sees it. In split-origin local development the UI calls it directly on the
// API origin. Both arrive here as /hub-config.

import { Router } from "express";
import {
  handleGetHubConfig,
  handleGetHubDocuments,
} from "../controllers/hubConfigController.js";

const router = Router();

router.get("/hub-config", handleGetHubConfig);

// Documents are a second call on purpose: around 30 KB of markdown that only
// the legal and About pages render. Putting them in the boot config would make
// every visitor download the terms of service to look at the feed.
router.get("/hub-config/documents", handleGetHubDocuments);

export default router;
