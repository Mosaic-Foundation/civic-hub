// Waitlist reads. It was inlined in services/hubSettings.ts, which is a
// settings module and had no business querying a table of people.
//
// Per hub since Phase 2a: a hub's admin sees the people waiting for THAT hub,
// read through forHub(). Before, every hub's Mode section listed everyone who
// had asked to join any hub on the deployment.

import { forHub } from "./forHub.js";

export interface WaitlistEntry {
  email: string;
  created_at: string;
  /** Optional — the form never requires it. */
  name: string | null;
  notes: string | null;
  /** Opted in to "I'd like to be a test user" on the waitlist form. */
  wants_test_user: boolean;
}

export async function getWaitlist(hubId: string): Promise<WaitlistEntry[]> {
  const { data, error } = await forHub(hubId)
    .from("waitlist")
    .select("email, created_at, name, notes, wants_test_user")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`waitlist.get: ${error.message}`);
  return (data ?? []) as WaitlistEntry[];
}
