// The waitlist table's write, for waitlistController (ADR-012, the database
// convention: a controller does not query). On this hub's waitlist only.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";

/**
 * Add an address to this hub's waitlist, or update its row there. The conflict
 * target names hub_id, so a second signup updates this hub's row and never
 * another hub's. A HubDbError propagates for the caller to map.
 */
export async function upsertWaitlistSignup(signup: {
  email: string;
  name: string | null;
  notes: string | null;
  wants_test_user: boolean;
  created_at: string;
}): Promise<void> {
  await forHub(currentHubId())
    .from("waitlist")
    .upsert(
      {
        email: signup.email,
        name: signup.name,
        notes: signup.notes,
        wants_test_user: signup.wants_test_user,
        created_at: signup.created_at,
      },
      { onConflict: "hub_id,email" },
    );
}
