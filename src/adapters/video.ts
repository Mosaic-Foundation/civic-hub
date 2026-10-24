// The `video` adapter (ADR-012): a meeting recording's transcript.
// Hosting: src/hosting/youtube.ts (Supadata, then SearchAPI, then the
// public transcript endpoint). Fake: src/adapters/fakes/video.ts.

export interface TranscriptSegment {
  /** Seconds into the video. */
  start: number;
  text: string;
}

export interface VideoTranscripts {
  readonly name: string;
  /** The transcript of a watch URL; throws when none can be had. */
  transcript(videoUrl: string): Promise<TranscriptSegment[]>;
}
