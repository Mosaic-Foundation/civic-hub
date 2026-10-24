// The one database read the dev seed (debugController) makes before it
// deletes anything (ADR-012, the database convention: a controller does not
// query). Development only; the seed routes are refused in production.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";

/** How many review_turns rows this hub has. They are append-only, so any block a reseed. */
export async function countReviewTurns(): Promise<number> {
  return forHub(currentHubId()).from("review_turns").count();
}
