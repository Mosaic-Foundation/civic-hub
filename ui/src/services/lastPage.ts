// The page a person was on before they opened a form that asks about it
// (feedback routing, 2026-10-13): a bug report carries the page it is about,
// whichever link brought the person to the form. App records every
// navigation; the form pages are left out, so they read the page before.

import { allFeatureSpaceLinks } from "../features";

const FORM_PAGES = new Set(["/admin/contact-civic-social"]);

/** A form page: the kernel's Contact Civic.Social, or a feature's (Feedback's form). */
function isFormPage(pathname: string): boolean {
  return FORM_PAGES.has(pathname) || allFeatureSpaceLinks().some((l) => l.formPage && l.path === pathname);
}

let last: string | null = null;

export function recordPage(pathname: string): void {
  if (!isFormPage(pathname)) last = pathname;
}

/** The last page that was not a form page, or null on a direct visit. */
export function lastPage(): string | null {
  return last;
}
