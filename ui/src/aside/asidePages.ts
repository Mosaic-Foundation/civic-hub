// Which pages draw the right column in the three-column layout (Adam,
// 2026-11-07): every public page but your settings, the hub's legal and info
// pages, sign-in and search. Admin keeps its own layout. Below
// THREE_COLUMN_QUERY no page draws it (Adam, 2026-11-07: the right column
// goes first, then the left gives way to the phone's bar).

/** The width from which the three columns sit side by side (the River's 80rem). */
export const THREE_COLUMN_QUERY = "(min-width: 1280px)";

const WITHOUT_ASIDE = new Set([
  "/settings",
  "/about",
  "/terms",
  "/privacy",
  "/code-of-conduct",
  "/welcome",
  "/sign-in",
  "/search",
]);

export function pageHasAside(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/admin" || path.startsWith("/admin/")) return false;
  return !WITHOUT_ASIDE.has(path);
}
