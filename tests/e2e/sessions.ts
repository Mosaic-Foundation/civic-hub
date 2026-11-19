/**
 * The local stack's sessions for the E2E specs: tests/fixtures/adminSession's
 * mintSession, with the member's About you card already asked, as for someone
 * who saw it once (districts and demographics, 2026-11-16). Without it the
 * card waits in front of a member's first vote, support or submit, and a spec
 * that does one of those times out behind it. actors.ts session() does the same.
 */

import { localRest, mintSession as mintFixtureSession } from "../fixtures/adminSession.js";

export { localRest, storedSetting } from "../fixtures/adminSession.js";

export async function mintSession(hubId: string, email: string): Promise<string> {
  const token = await mintFixtureSession(hubId, email);
  const [u] = (await localRest(`users?hub_id=eq.${hubId}&email=eq.${encodeURIComponent(email)}&select=id`)) as Array<{ id: string }>;
  if (u) {
    await localRest("member_about?on_conflict=hub_id,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ hub_id: hubId, user_id: u.id, asked_at: new Date().toISOString() }),
    });
  }
  return token;
}
