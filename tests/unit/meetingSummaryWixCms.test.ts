// Unit tests for the wix-cms connector.
//
// The fixture rows are shaped exactly like Floyd County's live collection,
// including the parts that caused real bugs: two URL conventions coexisting in
// one long-lived collection, label/URL sibling fields where only the URL half
// matters, two distinct meetings sharing a date, and two distinct meetings
// sharing a date AND a meeting type.

import { describe, it, expect } from "vitest";
import {
  normalizeWixDocUrl,
  parseWixMeetingDate,
  rowsToMeetings,
  type WixMeetingRow,
} from "../../src/modules/civic.meeting_summary/connectors/wixCms.js";

const ORIGIN = "https://www.floydcova.gov";
const OPTS = {
  site_origin: ORIGIN,
  collection: "2017Agenda",
  title_filter: "",
  type_exclude: "",
};

const ROWS: WixMeetingRow[] = [
  {
    title1: "August 11, 2026",
    title: "Regular Meeting",
    agendaPdf: "wix:document://v1/ugd/db2c48_19eba08a0bfc4c9db2d862863fd9eca4.pdf/5.%20Agenda.pdf",
    recording1: "https://www.youtube.com/watch?v=mm9_HIvBBlU",
  },
  {
    title1: "June 23, 2026",
    title: "Regular Meeting",
    agendaPdf: "wix:document://v1/ugd/49fff5_0fd4b1812819425c80786b9bfaf73999.pdf/5.%20AGENDA.pdf",
    minutesPdf: "https://ac85a31a.filesusr.com/ugd/49fff5_8386c44f8edc4708bf7e4ba000000000.pdf",
    recording1: "https://www.youtube.com/watch?v=HS0KLvawlJs",
  },
  {
    title1: "June 23, 2026",
    title: "Budget Workshop Meeting",
    agendaPdf: "wix:document://v1/ugd/49fff5_c0a41d0b065640258089e6535a34777f.pdf/Budget.pdf",
    minutesPdf: "wix:document://v1/ugd/49fff5_b786186c6a9440d2a9643ec2adf4112f.pdf/Min.pdf",
  },
  {
    title1: "April 14, 2026",
    title: "Regular Meeting",
    agendaPdf: "https://ac85a31a.filesusr.com/ugd/db2c48_aaaa.pdf",
    recording1: "https://www.youtube.com/watch?v=Dv0B_ZZo4N8",
    recording2: "Recording 2",
    recording21: "https://www.youtube.com/watch?v=AFefIVItmhE",
    recording3: "Recording 3",
    recording31: "https://www.youtube.com/watch?v=Lqxk8NBrPvM",
  },
  {
    title1: "May 12, 2026",
    title: "EMS Board Meeting",
    agendaPdf: "https://ac85a31a.filesusr.com/ugd/db2c48_bbbb.pdf",
    recording1: "https://www.youtube.com/watch?v=USY_Dk5Itv0",
  },
  // Two genuinely distinct budget workshops on one day — Floyd's 2023-04-11.
  {
    title1: "April 11, 2023",
    title: "Budget Workshop Meeting",
    agendaPdf: "https://ac85a31a.filesusr.com/ugd/db2c48_morning.pdf",
    recording1: "https://www.youtube.com/live/F6IMq4IhJBc",
  },
  {
    title1: "April 11, 2023",
    title: "Budget Workshop Meeting",
    agendaPdf: "https://ac85a31a.filesusr.com/ugd/db2c48_evening.pdf",
    recording1: "https://www.youtube.com/live/QCRAz_gn2dc",
  },
  // Announcement of a future meeting: no documents, no recording yet.
  { title1: "September 8, 2026", title: "Regular Meeting" },
  // Unparseable date — must be dropped, never guessed.
  { title1: "TBD", title: "Regular Meeting", agendaPdf: "https://x.test/a.pdf" },
];

describe("wixCms — date parsing", () => {
  it("parses Wix's display format", () => {
    expect(parseWixMeetingDate("August 11, 2026")).toBe("2026-08-11");
    expect(parseWixMeetingDate("June 9, 2026")).toBe("2026-06-09");
  });
  it("parses abbreviated months and slash dates", () => {
    expect(parseWixMeetingDate("Aug 11 2026")).toBe("2026-08-11");
    expect(parseWixMeetingDate("8/11/2026")).toBe("2026-08-11");
    expect(parseWixMeetingDate("2026-08-11")).toBe("2026-08-11");
  });
  it("returns null rather than guessing", () => {
    expect(parseWixMeetingDate("TBD")).toBeNull();
    expect(parseWixMeetingDate("")).toBeNull();
    expect(parseWixMeetingDate(undefined)).toBeNull();
    expect(parseWixMeetingDate("Smarch 40, 2026")).toBeNull();
  });
});

describe("wixCms — document URL normalization", () => {
  it("rewrites a wix:document reference onto the site origin", () => {
    expect(
      normalizeWixDocUrl(
        "wix:document://v1/ugd/db2c48_19eba08a0bfc4c9db2d862863fd9eca4.pdf/5.%20Agenda.pdf",
        ORIGIN,
      ),
    ).toBe(`${ORIGIN}/_files/ugd/db2c48_19eba08a0bfc4c9db2d862863fd9eca4.pdf`);
  });
  it("passes an already-absolute filesusr URL through unchanged", () => {
    const u = "https://ac85a31a.filesusr.com/ugd/49fff5_abc.pdf";
    expect(normalizeWixDocUrl(u, ORIGIN)).toBe(u);
  });
  it("returns null for an unrecognized reference instead of inventing a URL", () => {
    expect(normalizeWixDocUrl("", ORIGIN)).toBeNull();
    expect(normalizeWixDocUrl(undefined, ORIGIN)).toBeNull();
    expect(normalizeWixDocUrl("wix:image://v1/foo.jpg", ORIGIN)).toBeNull();
  });
});

describe("wixCms — mapping rows to meetings", () => {
  const entries = rowsToMeetings(ROWS, OPTS);

  it("drops rows with no parseable date", () => {
    expect(entries.some((e) => e.meeting_title === "Regular Meeting" && !e.meeting_date)).toBe(false);
    expect(entries).toHaveLength(7);
  });

  it("drops a future meeting that has no agenda, minutes, or recording", () => {
    expect(entries.some((e) => e.meeting_date === "2026-09-08")).toBe(false);
  });

  it("carries minutes, agenda, and recording through", () => {
    const june = entries.find(
      (e) => e.meeting_date === "2026-06-23" && e.meeting_title === "Regular Meeting",
    )!;
    expect(june.source_minutes_url).toContain("filesusr.com");
    expect(june.source_agenda_url).toBe(`${ORIGIN}/_files/ugd/49fff5_0fd4b1812819425c80786b9bfaf73999.pdf`);
    expect(june.source_video_url).toBe("https://www.youtube.com/watch?v=HS0KLvawlJs");
  });

  it("collects secondary recordings and ignores their label fields", () => {
    const apr = entries.find((e) => e.meeting_date === "2026-04-14")!;
    expect(apr.source_video_url).toBe("https://www.youtube.com/watch?v=Dv0B_ZZo4N8");
    expect(apr.additional_video_urls).toEqual([
      "https://www.youtube.com/watch?v=AFefIVItmhE",
      "https://www.youtube.com/watch?v=Lqxk8NBrPvM",
    ]);
  });

  it("keeps two different meetings held on the same date", () => {
    // A budget workshop and a regular meeting on 2026-06-23 are two meetings
    // with two sets of documents, not a duplicate.
    const sameDay = entries.filter((e) => e.meeting_date === "2026-06-23");
    expect(sameDay).toHaveLength(2);
    expect(new Set(sameDay.map((e) => e.source_id)).size).toBe(2);
  });

  it("keeps two meetings sharing a date AND a meeting type distinct", () => {
    // Floyd's 2023-04-11: two separate Budget Workshop Meetings, each with its
    // own agenda and recording. Colliding source_ids would mean one silently
    // shadowing the other.
    const pair = entries.filter((e) => e.meeting_date === "2023-04-11");
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((e) => e.source_id)).size).toBe(2);
  });

  it("gives every meeting a unique source_id", () => {
    expect(new Set(entries.map((e) => e.source_id)).size).toBe(entries.length);
  });

  it("produces source_ids that are stable across runs", () => {
    const again = rowsToMeetings(ROWS, OPTS);
    expect(again.map((e) => e.source_id)).toEqual(entries.map((e) => e.source_id));
  });

  it("is not sensitive to the order rows come back in", () => {
    const reversed = rowsToMeetings([...ROWS].reverse(), OPTS);
    expect(new Set(reversed.map((e) => e.source_id))).toEqual(
      new Set(entries.map((e) => e.source_id)),
    );
  });

  it("scopes source_id to the collection", () => {
    const other = rowsToMeetings(ROWS, { ...OPTS, collection: "OtherBody" });
    expect(other[0].source_id).not.toBe(entries[0].source_id);
    expect(entries[0].source_id).toContain("2017Agenda");
  });
});

describe("wixCms — filtering", () => {
  it("excludes another body's meetings by type", () => {
    const kept = rowsToMeetings(ROWS, { ...OPTS, type_exclude: "EMS Board" });
    expect(kept.some((e) => /EMS/i.test(e.meeting_title))).toBe(false);
    expect(kept).toHaveLength(6);
  });

  it("keeps budget workshops — they are Board business", () => {
    const kept = rowsToMeetings(ROWS, { ...OPTS, type_exclude: "EMS Board" });
    expect(kept.some((e) => e.meeting_title === "Budget Workshop Meeting")).toBe(true);
  });

  it("applies an include filter when one is set", () => {
    const kept = rowsToMeetings(ROWS, { ...OPTS, title_filter: "Budget Workshop" });
    expect(kept).toHaveLength(3);
    expect(kept.every((e) => e.meeting_title.includes("Budget Workshop"))).toBe(true);
  });

  it("applies exclusion after inclusion", () => {
    const kept = rowsToMeetings(ROWS, {
      ...OPTS,
      title_filter: "Meeting",
      type_exclude: "EMS Board,Budget Workshop",
    });
    expect(kept.some((e) => /EMS|Budget/i.test(e.meeting_title))).toBe(false);
  });

  it("keeps everything when both filters are empty", () => {
    expect(rowsToMeetings(ROWS, OPTS)).toHaveLength(7);
  });
});
