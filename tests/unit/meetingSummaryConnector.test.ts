// Unit tests for the youtube-channel connector.
//
// This module shipped with zero test coverage, which is a large part of why
// its discovery leg could return nothing for weeks without anyone noticing.
// The fixture below is a trimmed copy of the real Floyd County Government
// channel feed, including the awkward cases that actually occur there:
// a meeting posted as two videos, a meeting posted as three, an upload
// dated the day AFTER the meeting, an abbreviated body name, and a
// different body's meeting sharing the channel.

import { describe, it, expect } from "vitest";
import {
  cleanMeetingTitle,
  groupVideosIntoMeetings,
  isValidChannelId,
  matchesTitleFilter,
  parseChannelFeed,
  parseMeetingDateFromTitle,
  channelFeedUrl,
  type FeedVideo,
} from "../../src/modules/civic.meeting_summary/connectors/youtubeChannel.js";

const CHANNEL = "UCxyzO8F2UfiN1NVOax2s27Q";

function entry(videoId: string, title: string, published: string): string {
  return `
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${CHANNEL}</yt:channelId>
    <title>${title}</title>
    <published>${published}</published>
  </entry>`;
}

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <yt:channelId>${CHANNEL}</yt:channelId>
  <title>Floyd County Government</title>
  ${entry("mm9_HIvBBlU", "Floyd County Board of Supervisors Regular Meeting 08/11/2026", "2026-08-11T17:00:52+00:00")}
  ${entry("-clkKd5uaZA", "Floyd County Board of Supervisors Regular Meeting 08/11/2026", "2026-08-11T19:30:00+00:00")}
  ${entry("JERhIQTvfL8", "Floyd County Board of Supervisors Regular Meeting 07/28/2026", "2026-07-29T01:12:00+00:00")}
  ${entry("HS0KLvawlJs", "Floyd County Board of Supervisors Regular Meeting 06/23/2026", "2026-06-24T02:05:00+00:00")}
  ${entry("USY_Dk5Itv0", "Floyd County EMS Board Meeting 05/12/2026", "2026-05-13T00:00:00+00:00")}
  ${entry("ij8MoKyPGH8", "Floyd County BOS Meeting 04/28/2026", "2026-04-29T00:00:00+00:00")}
  ${entry("Dv0B_ZZo4N8", "Floyd County Board of Supervisors Meeting 04/14/2026", "2026-04-15T00:00:00+00:00")}
  ${entry("AFefIVItmhE", "Floyd County Board of Supervisors Meeting 04/14/2026 - 2", "2026-04-15T00:30:00+00:00")}
  ${entry("Lqxk8NBrPvM", "Floyd County Board of Supervisors Meeting 04/14/2026 - 3", "2026-04-15T01:00:00+00:00")}
</feed>`;

const BOS = "Board of Supervisors,BOS";

function discover(filter = BOS) {
  return groupVideosIntoMeetings(parseChannelFeed(FEED), {
    channel_id: CHANNEL,
    title_filter: filter,
  });
}

describe("youtubeChannel — feed parsing", () => {
  it("reads every well-formed entry out of the Atom feed", () => {
    const videos = parseChannelFeed(FEED);
    expect(videos).toHaveLength(9);
    expect(videos[0].video_id).toBe("mm9_HIvBBlU");
    expect(videos[0].feed_index).toBe(0);
  });

  it("decodes XML entities in titles", () => {
    const feed = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entry(
      "aaaaaaaaaaa",
      "Public Hearing FY27 Budget &amp; Regular Meeting 05/26/2026",
      "2026-05-27T00:00:00+00:00",
    )}</feed>`;
    expect(parseChannelFeed(feed)[0].title).toContain("Budget & Regular");
  });

  it("skips entries with a malformed video id rather than throwing", () => {
    const feed = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entry(
      "too-short",
      "Board of Supervisors Meeting 01/13/2026",
      "2026-01-14T00:00:00+00:00",
    )}${entry("bbbbbbbbbbb", "Board of Supervisors Meeting 01/27/2026", "2026-01-28T00:00:00+00:00")}</feed>`;
    const videos = parseChannelFeed(feed);
    expect(videos).toHaveLength(1);
    expect(videos[0].video_id).toBe("bbbbbbbbbbb");
  });

  it("returns an empty list for a feed with no entries, without throwing", () => {
    // The cron's discovery guard — not the parser — decides what empty means.
    expect(parseChannelFeed("<feed></feed>")).toEqual([]);
  });
});

describe("youtubeChannel — meeting date extraction", () => {
  it("reads MM/DD/YYYY", () => {
    expect(parseMeetingDateFromTitle("BOS Regular Meeting 08/11/2026")).toBe("2026-08-11");
  });
  it("reads single-digit month and day", () => {
    expect(parseMeetingDateFromTitle("BOS Meeting 4/7/2026")).toBe("2026-04-07");
  });
  it("reads ISO dates", () => {
    expect(parseMeetingDateFromTitle("BOS Meeting 2026-08-11")).toBe("2026-08-11");
  });
  it("reads a spelled-out month", () => {
    expect(parseMeetingDateFromTitle("BOS Meeting August 11, 2026")).toBe("2026-08-11");
    expect(parseMeetingDateFromTitle("BOS Meeting Aug 3 2026")).toBe("2026-08-03");
  });
  it("returns null when no year is present", () => {
    expect(parseMeetingDateFromTitle("BOS Meeting August 11")).toBeNull();
    expect(parseMeetingDateFromTitle("Regular Meeting")).toBeNull();
  });
  it("rejects impossible dates instead of emitting a bad ISO string", () => {
    expect(parseMeetingDateFromTitle("Meeting 13/45/2026")).toBeNull();
  });

  it("dates the meeting from the title, not the upload day", () => {
    // The 06/23 meeting was uploaded on 06/24. Dating it by upload time
    // would misfile the summary by a day and break dedupe against a
    // minutes-sourced entry for the same meeting.
    const june = discover().find((e) => e.meeting_title.includes("Regular Meeting") && e.meeting_date === "2026-06-23");
    expect(june).toBeDefined();
  });

  it("falls back to the publish date when the title carries none", () => {
    const videos: FeedVideo[] = [
      { video_id: "ccccccccccc", title: "Board of Supervisors Regular Meeting", published: "2026-02-10T18:00:00+00:00", feed_index: 0 },
    ];
    const [meeting] = groupVideosIntoMeetings(videos, { channel_id: CHANNEL, title_filter: BOS });
    expect(meeting.meeting_date).toBe("2026-02-10");
  });
});

describe("youtubeChannel — title cleaning", () => {
  it("strips the date", () => {
    expect(cleanMeetingTitle("Floyd County BOS Meeting 04/14/2026")).toBe("Floyd County BOS Meeting");
  });
  it("strips a trailing part marker", () => {
    expect(cleanMeetingTitle("Floyd County BOS Meeting 04/14/2026 - 3")).toBe("Floyd County BOS Meeting");
    expect(cleanMeetingTitle("BOS Meeting 04/14/2026 Part 2")).toBe("BOS Meeting");
  });
  it("gives every part of one meeting the same cleaned title", () => {
    const parts = [
      "Floyd County Board of Supervisors Meeting 04/14/2026",
      "Floyd County Board of Supervisors Meeting 04/14/2026 - 2",
      "Floyd County Board of Supervisors Meeting 04/14/2026 - 3",
    ].map(cleanMeetingTitle);
    expect(new Set(parts).size).toBe(1);
  });
});

describe("youtubeChannel — title filter", () => {
  it("keeps everything when the filter is empty", () => {
    expect(matchesTitleFilter("Anything At All", "")).toBe(true);
  });
  it("matches case-insensitively on any comma-separated needle", () => {
    expect(matchesTitleFilter("Floyd County BOS Meeting", BOS)).toBe(true);
    expect(matchesTitleFilter("floyd county board of supervisors", BOS)).toBe(true);
  });
  it("excludes another body's meeting from a shared channel", () => {
    expect(matchesTitleFilter("Floyd County EMS Board Meeting 05/12/2026", BOS)).toBe(false);
    expect(discover().some((e) => e.meeting_title.includes("EMS"))).toBe(false);
  });
  it("a filter that matches nothing yields no meetings", () => {
    expect(discover("Planning Commission")).toEqual([]);
  });
});

describe("youtubeChannel — grouping into meetings", () => {
  it("collapses multi-part uploads into one meeting", () => {
    const meetings = discover();
    const apr14 = meetings.find((m) => m.meeting_date === "2026-04-14");
    expect(apr14).toBeDefined();
    expect(apr14!.additional_video_urls).toHaveLength(2);
  });

  it("makes the earliest upload the primary recording", () => {
    const apr14 = discover().find((m) => m.meeting_date === "2026-04-14")!;
    expect(apr14.source_video_url).toBe("https://www.youtube.com/watch?v=Dv0B_ZZo4N8");
    expect(apr14.additional_video_urls).toEqual([
      "https://www.youtube.com/watch?v=AFefIVItmhE",
      "https://www.youtube.com/watch?v=Lqxk8NBrPvM",
    ]);
  });

  it("keeps meetings on different dates separate", () => {
    const dates = discover().map((m) => m.meeting_date).sort();
    expect(dates).toEqual([
      "2026-04-14", "2026-04-28", "2026-06-23", "2026-07-28", "2026-08-11",
    ]);
  });

  it("produces entries with a video source and no PDFs", () => {
    for (const m of discover()) {
      expect(m.source_video_url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
      expect(m.source_minutes_url).toBeNull();
      expect(m.source_agenda_url).toBeNull();
    }
  });

  it("gives each meeting a stable, channel-scoped, re-upload-proof source_id", () => {
    const first = discover().find((m) => m.meeting_date === "2026-08-11")!;
    // Same meeting re-uploaded under a new video id keeps its identity.
    const reuploaded = groupVideosIntoMeetings(
      [{ video_id: "zzzzzzzzzzz", title: "Floyd County Board of Supervisors Regular Meeting 08/11/2026", published: "2026-09-01T00:00:00+00:00", feed_index: 0 }],
      { channel_id: CHANNEL, title_filter: BOS },
    )[0];
    expect(reuploaded.source_id).toBe(first.source_id);
    expect(first.source_id).toContain(CHANNEL);
    expect(first.source_id).toContain("2026-08-11");
  });

  it("scopes source_id to the channel so two bodies cannot collide", () => {
    const other = groupVideosIntoMeetings(parseChannelFeed(FEED), {
      channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      title_filter: BOS,
    });
    expect(other[0].source_id).not.toBe(discover()[0].source_id);
  });
});

describe("youtubeChannel — channel id validation", () => {
  it("accepts a UC… id", () => {
    expect(isValidChannelId(CHANNEL)).toBe(true);
  });
  it("rejects an @handle, which is the mistake an operator actually makes", () => {
    expect(isValidChannelId("@FloydCountyGovernment")).toBe(false);
  });
  it("rejects an empty or malformed id", () => {
    expect(isValidChannelId("")).toBe(false);
    expect(isValidChannelId("UCtooshort")).toBe(false);
  });
  it("builds the documented feed URL", () => {
    expect(channelFeedUrl(CHANNEL)).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
    );
  });
});
