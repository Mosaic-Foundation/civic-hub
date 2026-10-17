// Meeting summaries made generic (the cleanup slice, 2026-10-16): the Wix
// columns, the PDF rule, YouTube's link forms, the waiting and quiet-source
// thresholds and the hub's own date. Each new setting reads, unset, exactly
// as the code did before, so an existing hub sees no change.

import { describe, expect, it } from "vitest";
import { DEFAULT_WIX_FIELDS, parseWixFields } from "../../src/shared/wixFields.js";
import { rowsToMeetings } from "../../src/modules/civic.meeting_summary/connectors/wixCms.js";
import { canonicalYouTubeUrl } from "../../src/modules/civic.meeting_summary/identity.js";
import { daysSetting, RECORD_GRACE_DAYS, SOURCE_QUIET_DAYS, todayIso } from "../../src/modules/civic.meeting_summary/readiness.js";
import { normalizeValue } from "../../src/models/hubSettingsWrite.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";
import { describeJobRun } from "../../src/jobs/describe.js";

const OPTS = { site_origin: "https://www.example.gov", collection: "Meetings", title_filter: "", type_exclude: "" };

describe("plugin.meeting_summary.wix_fields", () => {
  it("unset is the columns the connector always read", () => {
    expect(parseWixFields("")).toEqual({ fields: DEFAULT_WIX_FIELDS, errors: [] });
    expect(DEFAULT_WIX_FIELDS).toMatchObject({ date: "title1", type: "title", video: "recording1" });
  });

  it("names only the roles it changes", () => {
    const { fields, errors } = parseWixFields("date=meetingDate, minutes = minutesFile; more_video=part2 part3");
    expect(errors).toEqual([]);
    expect(fields).toEqual({ ...DEFAULT_WIX_FIELDS, date: "meetingDate", minutes: "minutesFile", more_video: ["part2", "part3"] });
  });

  it("says what is wrong, and the save refuses it", () => {
    expect(parseWixFields("when=date").errors[0]).toMatch(/one of date, type/);
    expect(parseWixFields("date=").errors[0]).toMatch(/name a column/);
    expect(parseWixFields("date=a b").errors[0]).toMatch(/takes one column/);
    const spec = fieldSpec("plugin.meeting_summary.wix_fields")!;
    expect(normalizeValue(spec, "when=date")).toMatchObject({ error: expect.stringMatching(/wix_fields/) });
    expect(normalizeValue(spec, " date=meetingDate ")).toBe("date=meetingDate");
  });

  it("reads another site's columns", () => {
    const { fields } = parseWixFields("date=meetingDate, type=kind, agenda=agendaFile, video=videoUrl, more_video=");
    const rows = [
      { meetingDate: "March 3, 2026", kind: "Council Meeting", agendaFile: "https://www.example.gov/a.pdf", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" },
      // The default columns are ignored once renamed.
      { title1: "March 4, 2026", title: "Regular Meeting", agendaPdf: "https://www.example.gov/b.pdf" },
    ];
    const entries = rowsToMeetings(rows, { ...OPTS, fields: { ...fields, more_video: [] } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ meeting_date: "2026-03-03", meeting_title: "Council Meeting", source_video_url: "https://www.youtube.com/watch?v=abcdefghijk" });
  });
});

describe("a recording in any YouTube form", () => {
  it("becomes the one watch form; anything else is not a recording", () => {
    const id = "I-Ruy-Cj-Yg";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=120`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/live/${id}?si=abc`,
      `https://www.youtube.com/embed/${id}`,
      `https://youtu.be/${id}`,
    ]) {
      expect(canonicalYouTubeUrl(url), url).toBe(`https://www.youtube.com/watch?v=${id}`);
    }
    expect(canonicalYouTubeUrl("https://vimeo.com/123456")).toBeNull();
    expect(canonicalYouTubeUrl("not a url")).toBeNull();
  });
});

describe("the waiting and quiet-source thresholds", () => {
  it("unset or not a whole number reads as the old constants", () => {
    expect(daysSetting(undefined, RECORD_GRACE_DAYS)).toBe(14);
    expect(daysSetting("", SOURCE_QUIET_DAYS)).toBe(45);
    expect(daysSetting("0", 14)).toBe(14);
    expect(daysSetting("2.5", 14)).toBe(14);
    expect(daysSetting(" 30 ", 14)).toBe(30);
  });

  it("a run is judged by the thresholds it recorded, and old rows by the constants", () => {
    const waiting = [{ meeting_date: "2026-09-01", meeting_title: "Regular Meeting", reason: "no transcript", days_since_meeting: 20 }];
    const body = (extra: Record<string, unknown>) => ({ status: 200, body: { discovered: 1, created: 0, failed: 0, waiting, ...extra } });
    expect(describeJobRun("meeting_summary", body({}))!.problems.join(" ")).toMatch(/waited 20 days/);
    expect(describeJobRun("meeting_summary", body({ record_grace_days: 30 }))!.problems).toEqual([]);
    const quiet = (extra: Record<string, unknown>) =>
      describeJobRun("meeting_summary", { status: 200, body: { discovered: 0, newest_meeting_date: "2026-07-01", days_since_newest_meeting: 60, ...extra } })!.problems;
    expect(quiet({}).join(" ")).toMatch(/No new meetings found/);
    expect(quiet({ source_quiet_days: 90 })).toEqual([]);
  });
});

describe("today, in the hub's time zone", () => {
  it("is the hub's date, not UTC's, in the evening of a US meeting day", () => {
    const evening = new Date("2026-10-14T01:30:00Z"); // 9:30 pm on the 13th in New York
    expect(todayIso(evening)).toBe("2026-10-14");
    expect(todayIso(evening, "America/New_York")).toBe("2026-10-13");
    expect(todayIso(evening, "Not/AZone")).toBe("2026-10-14");
  });
});
