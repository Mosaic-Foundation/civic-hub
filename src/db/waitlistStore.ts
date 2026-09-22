// Waitlist reads. In src/db/ because it uses the raw client; it was inlined
// in services/hubSettings.ts, which is a settings module and had no business
// querying a table of people.

import { getDb } from "./client.js";

export interface WaitlistEntry {
  email: string;
  created_at: string;
  /** Optional — the form never requires it. */
  name: string | null;
  notes: string | null;
  /** Opted in to "I'd like to be a test user" on the waitlist form. */
  wants_test_user: boolean;
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await getDb()
    .from("waitlist")
    .select("email, created_at, name, notes, wants_test_user")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`waitlist.get: ${error.message}`);
  return (data ?? []) as WaitlistEntry[];
}
