// The feed's closing reminders' window (Events 4): the hub's
// `feed.closing_reminder_hours`, one value for every type.
import { describe, expect, it } from "vitest";
import { CLOSING_SOON_MS, closingSoonWindowMs } from "../../src/services/closingSoon.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";

describe("the closing reminders' window", () => {
  it("is 48 hours unless set, the hours set, and none at 0", () => {
    expect(CLOSING_SOON_MS).toBe(48 * 3_600_000);
    expect(closingSoonWindowMs(undefined)).toBe(CLOSING_SOON_MS);
    expect(closingSoonWindowMs("")).toBe(CLOSING_SOON_MS);
    expect(closingSoonWindowMs("72")).toBe(72 * 3_600_000);
    expect(closingSoonWindowMs("0")).toBe(0);
    for (const bad of ["-5", "1.5", "two days"]) expect(closingSoonWindowMs(bad), bad).toBe(CLOSING_SOON_MS);
  });

  it("is an admin's to set in Settings, 0 to 14 days in hours", () => {
    expect(fieldSpec("feed.closing_reminder_hours")).toEqual({ key: "feed.closing_reminder_hours", kind: "number", min: 0, max: 336 });
  });
});
