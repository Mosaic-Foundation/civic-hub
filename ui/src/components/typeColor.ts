/**
 * Process type → the --type-<slug>-* color token family (theme.css).
 *
 * One map for every surface that colors by type but is not a feed card
 * (the feed classifies by activity, in src/shared/feedActivity.ts). Briefs
 * and vote results take the hub's terracotta so an outcome reads as its
 * own kind of thing; everything unknown falls back to "generic", so a type
 * registered tomorrow renders sensibly before anyone picks it a color.
 */
const SLUG: Record<string, string> = {
  "civic.vote": "vote",
  "civic.proposal": "proposal",
  "civic.polis_deliberation": "conversation",
  "civic.project": "project",
  "civic.wordcloud": "wordcloud",
  "civic.announcement": "announcement",
  "civic.meeting_summary": "meeting",
  "civic.brief": "brief",
  "civic.vote_results": "brief",
};

export function typeColorSlug(type: string): string {
  return SLUG[type] ?? "generic";
}
