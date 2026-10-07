// The pure parts of the UI's plugin gating: decisions that take what the hub
// config says as arguments, so tests/unit can check them without a browser
// or a loaded config. config/plugins.tsx applies them to the loaded config.

/**
 * Where a brand-new account lands: the hub's word cloud, when it names one
 * AND Word clouds is switched on; otherwise null (stay where they are, the
 * home page for a fresh sign-up). A switched-off cloud would be "Page not
 * found" as the very first thing a new member sees.
 */
export function onboardingTarget(
  onboardingId: string | undefined | null,
  wordcloudEnabled: boolean,
): string | null {
  const id = onboardingId?.trim();
  if (!id || !wordcloudEnabled) return null;
  return `/wordcloud/${encodeURIComponent(id)}?onboarding=1`;
}

/** The process type behind each search type chip (src/modules/civic.search). */
export const SEARCH_TYPE_PROCESS: Readonly<Record<string, string>> = {
  vote: "civic.vote",
  vote_results: "civic.vote_results",
  announcement: "civic.announcement",
  meeting_summary: "civic.meeting_summary",
};

/** The search chips to offer: only types the hub shows. */
export function searchChipsShown<T extends { key: string }>(
  choices: readonly T[],
  typeShown: (processType: string) => boolean,
): T[] {
  return choices.filter((c) => {
    const type = SEARCH_TYPE_PROCESS[c.key];
    return !type || typeShown(type);
  });
}
