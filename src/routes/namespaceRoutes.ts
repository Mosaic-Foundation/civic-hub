import { Router } from "express";
import { handleGetNamespace } from "../controllers/namespaceController.js";

const router = Router();

// The target of the `hub:` prefix in every activity's @context.
router.get("/", handleGetNamespace);

export default router;
