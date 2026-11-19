// The pure parts of the UI's plugin gating: decisions that take what the hub
// config says as arguments, so tests/unit can check them without a browser
// or a loaded config. config/plugins.tsx applies them to the loaded config.

/**
 * A path on this site to send someone back to, or null. Only a local path:
 * "/process/abc?x=1" passes; "//elsewhere.example", "https://…" and
 * "javascript:…" do not, so the parameter cannot become an open redirect.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  const p = raw?.trim();
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return null;
  return p;
}

/** The process type behind each search type chip (src/modules/civic.search). */
export const SEARCH_TYPE_PROCESS: Readonly<Record<string, string>> = {
  vote: "civic.vote",
  vote_results: "civic.brief",
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
