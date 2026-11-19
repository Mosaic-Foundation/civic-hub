// The Civic Hub's palette: the colour families, card kinds and digest sections
// of the process types it curates. Moved out of the kernel's feed, theme and
// digest (kernel step 3, Nov 19) with every value and order unchanged.
// Plain data: the UI reads it through config/spacePalette.ts.

import type { SpacePalette } from "../../src/shared/spacePalette.js";

export const civicPalette: SpacePalette = {
  // Settings → Theme lists the families with a `theme`, in this order. Not
  // vote's legacy pill: --pill-vote-* doubles as the general control accent
  // (~25 sites in App.css), which should follow primary, not the votes hue.
  colors: [
    { key: "vote", theme: { label: "Votes", hue: "#15294c", follows: "primary" }, email: { bg: "#dce5f2", fg: "#1e3a5f" } },
    { key: "proposal", theme: { label: "Proposals", hue: "#5f4b8b", legacyPill: true }, email: { bg: "#eae7f0", fg: "#5f4b8b" } },
    { key: "conversation", theme: { label: "Conversations", hue: "#0f5e66", legacyPill: true }, email: { bg: "#ddefef", fg: "#0f5e66" } },
    { key: "project", theme: { label: "Projects", hue: "#1565c0", legacyPill: true }, email: { bg: "#e3f2fd", fg: "#1565c0" } },
    { key: "announcement", theme: { label: "Announcements", hue: "#6e3013", follows: "accent", legacyPill: true }, email: { bg: "#fbe5d3", fg: "#8c3210" } },
    // Posts News Sync copies in from another site (2026-11-16, Adam).
    { key: "news", theme: { label: "News", hue: "#34495a" }, email: { bg: "#e3e8ec", fg: "#34495a" } },
    { key: "meeting", theme: { label: "Meeting summaries", hue: "#2a7340", legacyPill: true }, email: { bg: "#d9ecd9", fg: "#0f4a26" } },
    { key: "brief", theme: { label: "Civic briefs", hue: "#6e3013", follows: "accent", legacyPill: true, ruleAndWash: true } },
    { key: "wordcloud", theme: { label: "Word clouds", hue: "#5c6b2a", legacyPill: true }, email: { bg: "#edf0dd", fg: "#5c6b2a" } },
    // An elected official's or committee's announcement, apart from the hub's own.
    { key: "announcement-author", email: { bg: "#e4ddf0", fg: "#3a2c5e" } },
    // An ACT (the government answering a brief), not a process: gold everywhere.
    { key: "official-response", email: { bg: "#fdf1e0", fg: "#8a5a13" } },
  ],
  // The digest sorts by `order` (votes, results, meeting summaries,
  // announcements, word clouds, proposals, projects, conversations, briefs),
  // then newest first inside each.
  kinds: [
    { kind: "vote-open", section: "votes_open", order: 0, meta: true },
    { kind: "vote-closed", section: "vote_results", order: 1, meta: true, note: "Results" },
    { kind: "vote-results", section: "vote_results", order: 1, meta: true },
    { kind: "meeting", section: "meeting_summaries", order: 2, meta: true },
    { kind: "announcement", section: "announcements", order: 3, meta: true },
    { kind: "announcement-author", section: "announcements", order: 4, meta: true },
    { kind: "news", section: "news", order: 4, meta: true },
    { kind: "wordcloud", section: "word_clouds", order: 5, meta: true },
    { kind: "proposal", section: "proposals", order: 6 },
    { kind: "proposal-closed", section: "proposals", order: 7, note: "Results" },
    { kind: "project-created", section: "projects", order: 8, meta: true },
    { kind: "project-updated", section: "projects", order: 9, meta: true, note: "Update" },
    { kind: "conversation", section: "conversations", order: 10, meta: true },
    { kind: "conversation-results", section: "conversations", order: 11, meta: true, note: "Results" },
    // A brief's card is its publish event; a regenerated version replaces its
    // headline in place, marked "Updated <date>".
    { kind: "brief", section: "briefs", order: 12, meta: true },
    // A response belongs with the outcome it answers: "Completed — results"
    // carries both the brief and, later, the government's reply to it.
    { kind: "brief-response", section: "briefs", order: 13, note: "Official response", context: true },
  ],
  sections: [
    { key: "votes_open", heading: "New votes open" },
    { key: "vote_results", heading: "New vote results" },
    { key: "meeting_summaries", heading: "New meeting summaries" },
    { key: "announcements", heading: "Announcements" },
    { key: "news", heading: "News" },
    { key: "word_clouds", heading: "Word clouds" },
    { key: "proposals", heading: "Proposals" },
    { key: "projects", heading: "Projects" },
    { key: "conversations", heading: "Conversations" },
    { key: "briefs", heading: "Completed — results", last: true },
  ],
  fallbackSection: "announcements",
};

export default civicPalette;
