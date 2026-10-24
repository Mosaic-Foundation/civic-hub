// The `video` adapter's fake (ADR-012): a fixed transcript, or none for a URL
// containing "no-transcript".

import type { TranscriptSegment, VideoTranscripts } from "../video.js";

export function fakeVideo(): VideoTranscripts & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: "fake",
    asked,
    async transcript(videoUrl: string): Promise<TranscriptSegment[]> {
      asked.push(videoUrl);
      if (videoUrl.includes("no-transcript")) throw new Error("fake video: no transcript for this video");
      return [
        { start: 0, text: "Test transcript: the meeting is called to order." },
        { start: 60, text: "Test transcript: the meeting is adjourned." },
      ];
    },
  };
}
