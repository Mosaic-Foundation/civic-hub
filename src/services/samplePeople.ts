// The sample people (Phase 7; kernel step 4): who sample content is written
// by, on every hub, whatever its space type. The kernel keeps them (the seed
// upserts them, removing the samples removes them) and a seeder names one by
// key through SampleKit.author. user_sample_<hub>_00n.

export interface SampleAuthor {
  /** n in user_sample_<hub>_00n. */
  n: number;
  /** Filled like the samples' texts: may use {HUB_NAME}, {JURISDICTION}, {GOVERNING_BODY}. */
  full_name: string;
}

export const SAMPLE_AUTHORS = {
  JORDAN: { n: 1, full_name: "Jordan P." },
  ALEX: { n: 2, full_name: "Alex R." },
  CASEY: { n: 3, full_name: "Casey M." },
  SAM: { n: 4, full_name: "Sam T." },
  // Not a real office: a sample announcement must not appear to speak for
  // the local government, even out of context (Adam, 2026-09-26).
  TEAM: { n: 5, full_name: "{HUB_NAME} team" },
} as const satisfies Record<string, SampleAuthor>;

export type SampleAuthorKey = keyof typeof SAMPLE_AUTHORS;
