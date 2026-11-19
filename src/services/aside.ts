// The right column's facts (layout session, 2026-11-07; ADR-019): what
// GET /api/aside serves the three-column layout's kernel cards. A read of what
// the space already shows, nothing new:
//
//   - Coming up is the calendar's events only (Events 4, Adam, 2026-11-09),
//     read from GET /calendar/events; it has nothing here.
//   - The Pinned card, and the urgent line across the top of the pages, are
//     the Pinning plugin's (features/pinning, kernel step 4), read from its
//     own GET /pins.
//   - about: the member count, when the Members plugin is on and its count is
//     public (the same rule as GET /members/summary). The place and the About
//     link are the space's config, which the page already has.
//
// The same for every reader. No account, name or ballot is in it.

import { memberVisibility } from "./members.js";
import { isPluginEnabledSync } from "./hubSettings.js";

export interface AsideFacts {
  about: { member_count: number | null };
}

export async function readAside(): Promise<AsideFacts> {
  return { about: { member_count: await readMemberCount() } };
}

async function readMemberCount(): Promise<number | null> {
  if (!isPluginEnabledSync("members")) return null;
  const seen = await memberVisibility();
  return seen.countShown ? seen.count : null;
}
