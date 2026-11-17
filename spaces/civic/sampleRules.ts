// Rules of the Civic Hub's sample votes, kept pure so the sample refresh's
// tests read them without a database.

/**
 * Endorsements a tester must add, beyond the seeded ones, before a sample vote
 * gathering endorsements opens (Adam, 2026-11-06): one tester's endorsement
 * must not open it into a live vote by accident.
 */
export const SAMPLE_ENDORSEMENT_FLOOR = 5;

/**
 * A sample vote's endorsement threshold: the hub's, but never fewer than
 * SAMPLE_ENDORSEMENT_FLOOR beyond its seeded endorsers, whatever the hub's
 * threshold (a hub's may be 0). Pure.
 */
export function sampleSupportThreshold(hubThreshold: number, seededEndorsers: number): number {
  return Math.max(hubThreshold, seededEndorsers + SAMPLE_ENDORSEMENT_FLOOR);
}
