// Debug routes — seed data for rapid testing
// NOT for production use
//
// POST, and a hub admin's (Audit 2, 2026-10-11). It wipes the hub's
// processes, events, accounts and sessions, so it was never safe as an
// unauthenticated GET: any page could trigger it cross-site. It also refuses
// to run unless CIVIC_ALLOW_SEED=true, and never with NODE_ENV=production
// (src/config/devFlags.ts).

import { Router } from "express";
import { handleSeed } from "../controllers/debugController.js";
import { requireAdmin } from "../middleware/auth.js";
import { route } from "../http/route.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { polisFakeEnabled } from "../config/devFlags.js";
import {
  clearFakePolisCalls,
  fakePolisState,
  setFakePolisMode,
  type FakePolisMode,
} from "../debug/fakePolis.js";

const router = Router();

router.post("/seed", requireAdmin, handleSeed);

// The in-memory Polis (CIVIC_POLIS_FAKE=on only; not there otherwise, and
// never in production): what the hub sent it, and making it down, slow or
// erroring, for the conformance suite's Tier 3 checks.
const FAKE_MODES: readonly FakePolisMode[] = ["up", "down", "slow", "error"];
const fakeOnly = route((_req, _res, next) => {
  if (!polisFakeEnabled()) throw new NotFoundError("Not found");
  next();
});
router.get("/polis-fake", fakeOnly, requireAdmin, route((_req, res) => {
  res.json(fakePolisState());
}));
router.put("/polis-fake", fakeOnly, requireAdmin, route((req, res) => {
  const { mode, slow_ms, clear_calls } = (req.body ?? {}) as { mode?: string; slow_ms?: number; clear_calls?: boolean };
  if (mode !== undefined) {
    if (!FAKE_MODES.includes(mode as FakePolisMode)) throw new ValidationError(`mode must be one of ${FAKE_MODES.join(", ")}`);
    setFakePolisMode(mode as FakePolisMode, typeof slow_ms === "number" ? { slowMs: slow_ms } : {});
  }
  if (clear_calls) clearFakePolisCalls();
  res.json(fakePolisState());
}));

export default router;
