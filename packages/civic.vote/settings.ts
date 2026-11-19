// Votes' own settings (plugin.vote.*), read for the hub in scope through the
// kernel's settingsOf (kernel step 1). The settings page lists them from the
// manifest's pluginSection.

import { settingsOf } from "@civic-social/plugin-sdk";
import { DEFAULT_CHECK_MODE, isCheckMode, type CheckMode } from "./checkMode.js";

const own = () => settingsOf("vote");

/** A whole number from a stored setting, or the fallback. */
function wholeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * The range of voting windows a resident may choose on this hub, in days, and
 * where a new draft starts. Unset keys keep the numbers that were in code
 * before they were settings (14, 90, 42). A range an admin set backwards is
 * put the right way round, and the default is kept inside it, so a
 * half-edited range can never make every duration invalid.
 */
export const VOTE_DURATION_DEFAULTS = { minDays: 14, maxDays: 90, defaultDays: 42 } as const;
const DURATION_DAYS_CEILING = 365;

export function voteDurationLimits(): { minDays: number; maxDays: number; defaultDays: number } {
  const settings = own();
  const days = (name: string, fallback: number) => {
    const n = wholeNumber(settings.get(name), fallback);
    return Number.isInteger(n) && n >= 1 && n <= DURATION_DAYS_CEILING ? n : fallback;
  };
  let minDays = days("min_duration_days", VOTE_DURATION_DEFAULTS.minDays);
  let maxDays = days("max_duration_days", VOTE_DURATION_DEFAULTS.maxDays);
  if (minDays > maxDays) [minDays, maxDays] = [maxDays, minDays];
  const wanted = days("default_duration_days", VOTE_DURATION_DEFAULTS.defaultDays);
  const defaultDays = Math.min(maxDays, Math.max(minDays, wanted));
  return { minDays, maxDays, defaultDays };
}

/**
 * Endorsements a resident-submitted vote needs before it opens for ballots.
 * Read once at submission and snapshotted onto the vote, so changing it never
 * moves a vote that is already gathering support. 0 means no support phase:
 * approval opens the vote directly. (The admins' settings page writes it.)
 */
const DEFAULT_SUPPORT_THRESHOLD = 5;

export function supportThreshold(): number {
  const n = wholeNumber(own().get("support_threshold"), DEFAULT_SUPPORT_THRESHOLD);
  return n >= 0 ? n : DEFAULT_SUPPORT_THRESHOLD;
}

/** The receipt check mode a new vote's draft starts with (./checkMode.ts). */
export function defaultCheckMode(): CheckMode {
  const v = own().get("default_check_mode");
  return isCheckMode(v) ? v : DEFAULT_CHECK_MODE;
}
