// FIXTURE DATA — dev seed content for scripts/seedDevPendingBrief.ts: a
// pending Civic Brief seeded on the dev database, themed around Floyd, for
// exercising the admin review flow without closing a real process.

export const SEED_DEV_PENDING_BRIEF_JURISDICTION = "us-va-floyd";
export const SEED_DEV_PENDING_BRIEF_HUB_ID = "floyd-civic-hub";

export const SEED_DEV_PENDING_BRIEF_CONTENT = {
  title: "TEST — Sidewalk connectivity in the town of Floyd",
  headline: "Broad agreement that the gaps on Main Street come first",
  summary:
    "Residents talked through where new sidewalk segments would matter most. " +
    "The clearest common ground: closing the two gaps along Main Street " +
    "between the school and the library, before any new segments elsewhere.\n\n" +
    "This is a seeded TEST brief for exercising the review flow — safe to " +
    "edit, approve, and respond to on dev.",
  sections: [
    {
      heading: "Where the community agreed",
      body: "Main Street gaps first; school walking routes second; decorative extensions last.",
    },
  ],
  participation_label: "23 participants",
  participation_count: 23,
  comments: [
    "My kids walk that stretch every day — the gap by the library is the scary part.",
    "Fix what's half-built before starting anything new.",
  ],
  admin_notes: "",
  image_url: null as string | null,
  image_alt: null as string | null,
};
