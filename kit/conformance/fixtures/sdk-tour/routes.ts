// The SDK tour's own route, under /sdk-tour: who joined, as the hub discloses it.

import { Router } from "express";
import { namesFor, route } from "@civic-social/plugin-sdk";
import { sdkTourStore } from "./store.js";

const router = Router();

// GET /sdk-tour/:id/joined: how many joined, and who: names to signed-in members,
// none to the public (the type's `members` policy), never an account (A3).
router.get(
  "/:id/joined",
  route(async (req, res) => {
    const id = String(req.params.id);
    const accounts = await sdkTourStore.get().joinedAccounts(id);
    res.json({ count: accounts.length, names: await namesFor(req, id, accounts) });
  }),
);

export default router;
