// The page a person was on before they opened a form that asks about it
// (feedback routing, 2026-10-15): a bug report carries the page it is about,
// whichever link brought the person to the form. App records every
// navigation; the form pages are left out, so they read the page before.

const FORM_PAGES = new Set(["/feedback", "/admin/contact-civic-social"]);

let last: string | null = null;

export function recordPage(pathname: string): void {
  if (!FORM_PAGES.has(pathname)) last = pathname;
}

/** The last page that was not a form page, or null on a direct visit. */
export function lastPage(): string | null {
  return last;
}
