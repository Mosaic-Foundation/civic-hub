// A vote's results from before briefs (civic.vote_results, retired in engine
// 2, C): its record is a brief now, at the same id, so its published API
// address keeps answering by sending the reader to the brief. Relative, so it
// holds behind Vercel's /api prefix and without it.

import { Router } from "express";

const router = Router();

// GET /vote-results/:id → 301 ../brief/:id
router.get("/:id", (req, res) => {
  res.redirect(301, `../brief/${encodeURIComponent(String(req.params.id))}`);
});

export default router;
