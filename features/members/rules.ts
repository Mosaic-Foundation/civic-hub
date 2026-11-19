// The Members plugin's rule (Adam, 2026-10-14; a plugin of its own since
// kernel step 4, 2026-11-19): what residents see of the space's members.
//
// Below `plugin.members.min_count` members, residents see no count, no faces
// and no Members page, unless `page_before_threshold` shows the page anyway.
// Admins always see all of it. The number itself is withheld by the server,
// not just hidden by the page. Plain data and a pure function, shared by the
// server and the UI.

export const MIN_COUNT_KEY = "plugin.members.min_count";
export const PAGE_BEFORE_THRESHOLD_KEY = "plugin.members.page_before_threshold";

/** What residents may see of the space's members now. */
export interface MemberVisibility {
  /** Every member, hidden ones included. */
  count: number;
  /** `plugin.members.min_count`; 0 when unset. */
  threshold: number;
  /** The count and the faces. */
  countShown: boolean;
  /** The Members page and its section in the navigation. */
  pageShown: boolean;
}

/** The stored number, read as the settings read one; 0 when unset or unreadable. */
function asNumber(value: string | null | undefined): number {
  if (value === undefined || value === null) return 0;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** The rule, from the count and the two stored settings. */
export function visibilityOf(count: number, minCount: string | null | undefined, pageBefore: string | null | undefined): MemberVisibility {
  const threshold = Math.max(0, asNumber(minCount));
  const countShown = count >= threshold;
  const pageShown = countShown || pageBefore?.trim().toLowerCase() === "true";
  return { count, threshold, countShown, pageShown };
}
