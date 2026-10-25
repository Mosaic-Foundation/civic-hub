/**
 * Collapse the verify response's two flat official_* fields into the
 * shape AuthContext holds. Both must be present — a type with no title
 * has nothing to render (the same both-or-neither rule the DB enforces).
 */
export function officialFrom(result: {
  official_type: string | null;
  official_title: string | null;
}): { type: string; title: string } | null {
  return result.official_type && result.official_title
    ? { type: result.official_type, title: result.official_title }
    : null;
}
