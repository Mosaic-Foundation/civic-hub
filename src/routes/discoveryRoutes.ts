import { Router } from "express";
import { handleDiscoveryManifest } from "../controllers/discoveryController.js";
import { handleDidDocument } from "../controllers/didController.js";

const router = Router();

router.get("/civic.json", handleDiscoveryManifest);
router.get("/did.json", handleDidDocument);

export default router;
