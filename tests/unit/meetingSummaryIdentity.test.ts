// Cross-connector meeting identity.
//
// Guards the migration hazard: `source_id` is minted by whichever connector
// found the meeting, so changing connectors renames every meeting in the
// database and the cron re-summarizes all of them. The documents underneath
// do not change, and that is what these fingerprints key on.

import { describe, it, expect } from "vitest";
import {
  documentFingerprint,
  sourceFingerprints,
  videoFingerprint,
} from "../../src/modules/civic.meeting_summary/identity.js";

describe("documentFingerprint", () => {
  it("treats the same Wix file served from different hosts as one document", () => {
    // The HTML page linked the site host; the CMS returns filesusr.com. Same PDF.
    const viaSite = documentFingerprint(
      "https://www.floydcova.gov/_files/ugd/db2c48_31195cc1b0b0496783561fe00cb3f952.pdf",
    );
    const viaFilesusr = documentFingerprint(
      "https://ac85a31a-5c8b-498c-9c6f-f911aaebccfd.filesusr.com/ugd/db2c48_31195cc1b0b0496783561fe00cb3f952.pdf",
    );
    expect(viaSite).toBe(viaFilesusr);
  });

  it("matches a wix:document reference to its resolved URL", () => {
    expect(
      documentFingerprint("wix:document://v1/ugd/db2c48_abc123.pdf/Minutes.pdf"),
    ).toBe(documentFingerprint("https://www.floydcova.gov/_files/ugd/db2c48_abc123.pdf"));
  });

  it("keeps different documents distinct", () => {
    expect(documentFingerprint("https://x.test/ugd/a_1.pdf")).not.toBe(
      documentFingerprint("https://x.test/ugd/a_2.pdf"),
    );
  });

  it("returns null for absent values", () => {
    expect(documentFingerprint(null)).toBeNull();
    expect(documentFingerprint("")).toBeNull();
    expect(documentFingerprint(undefined)).toBeNull();
  });
});

describe("videoFingerprint", () => {
  it("collapses watch, live, youtu.be and embed forms of one video", () => {
    const forms = [
      "https://www.youtube.com/watch?v=mm9_HIvBBlU",
      "https://youtube.com/watch?v=mm9_HIvBBlU&t=42",
      "https://www.youtube.com/live/mm9_HIvBBlU",
      "https://youtu.be/mm9_HIvBBlU",
      "https://www.youtube.com/embed/mm9_HIvBBlU",
    ].map(videoFingerprint);
    expect(new Set(forms).size).toBe(1);
    expect(forms[0]).toBe("yt:mm9_HIvBBlU");
  });

  it("keeps different videos distinct", () => {
    expect(videoFingerprint("https://www.youtube.com/watch?v=mm9_HIvBBlU")).not.toBe(
      videoFingerprint("https://www.youtube.com/watch?v=JERhIQTvfL8"),
    );
  });

  it("falls back to host and path for non-YouTube recordings", () => {
    expect(videoFingerprint("https://vimeo.com/123456")).toBe("vid:vimeo.com/123456");
  });
});

describe("sourceFingerprints — the migration case", () => {
  // What the OLD html connector stored for Floyd's 2026-06-23 regular meeting.
  const existingSummary = {
    source_minutes_url: "https://www.floydcova.gov/_files/ugd/49fff5_8386c44.pdf",
    source_agenda_url: "https://www.floydcova.gov/_files/ugd/49fff5_0fd4b18.pdf",
    source_video_url: "https://www.youtube.com/watch?v=HS0KLvawlJs",
    additional_video_urls: [],
  };

  // What the NEW wix-cms connector produces for the same meeting.
  const newEntry = {
    source_minutes_url: "https://ac85a31a.filesusr.com/ugd/49fff5_8386c44.pdf",
    source_agenda_url: "https://www.floydcova.gov/_files/ugd/49fff5_0fd4b18.pdf",
    source_video_url: "https://www.youtube.com/watch?v=HS0KLvawlJs",
    additional_video_urls: [],
  };

  it("recognizes the same meeting across a connector change", () => {
    const before = new Set(sourceFingerprints(existingSummary));
    const after = sourceFingerprints(newEntry);
    expect(after.some((fp) => before.has(fp))).toBe(true);
  });

  it("does NOT match a different meeting", () => {
    const other = sourceFingerprints({
      source_minutes_url: "https://www.floydcova.gov/_files/ugd/49fff5_different.pdf",
      source_agenda_url: null,
      source_video_url: "https://www.youtube.com/watch?v=JERhIQTvfL8",
      additional_video_urls: [],
    });
    const before = new Set(sourceFingerprints(existingSummary));
    expect(other.some((fp) => before.has(fp))).toBe(false);
  });

  it("matches on the recording alone when only the video is shared", () => {
    // A youtube-channel summary carries no documents; a later wix-cms entry
    // for the same meeting must still recognize it.
    const recordingOnly = sourceFingerprints({
      source_minutes_url: null,
      source_agenda_url: null,
      source_video_url: "https://www.youtube.com/watch?v=HS0KLvawlJs",
      additional_video_urls: [],
    });
    const before = new Set(sourceFingerprints(existingSummary));
    expect(recordingOnly.some((fp) => before.has(fp))).toBe(true);
  });

  it("includes secondary recordings, so a multi-part meeting still matches", () => {
    const fps = sourceFingerprints({
      source_minutes_url: null,
      source_agenda_url: null,
      source_video_url: "https://www.youtube.com/watch?v=Dv0B_ZZo4N8",
      additional_video_urls: ["https://www.youtube.com/watch?v=AFefIVItmhE"],
    });
    expect(fps).toContain("yt:AFefIVItmhE");
  });

  it("returns nothing for a meeting with no sources at all", () => {
    expect(
      sourceFingerprints({
        source_minutes_url: null,
        source_agenda_url: null,
        source_video_url: null,
        additional_video_urls: [],
      }),
    ).toEqual([]);
  });
});
