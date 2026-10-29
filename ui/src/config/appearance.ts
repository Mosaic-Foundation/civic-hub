// A person's look after the first paint (design pass, decision 9,
// 2026-10-29). public/appearance.js sets data-mode on <html> before anything
// renders; this keeps it in step: a signed-in person's account setting
// (light by default) is mirrored into this browser, and a signed-out reader's
// own choice (the footer's) is kept here. A signed-out reader who chose
// nothing follows the device. styles/tokens/dark.css is the dark set.

export type Appearance = "light" | "dark" | "system";
export const APPEARANCES: readonly Appearance[] = ["light", "dark", "system"];

const KEY = "civic_appearance";
let current: Appearance = "system";
let following: MediaQueryList | null = null;

function isAppearance(v: unknown): v is Appearance {
  return typeof v === "string" && (APPEARANCES as readonly string[]).includes(v);
}

/** What this browser has: the signed-in person's mirror or a reader's choice; null when nothing. */
export function storedAppearance(): Appearance | null {
  try {
    const v = localStorage.getItem(KEY);
    return isAppearance(v) ? v : null;
  } catch {
    return null;
  }
}

function paint(): void {
  if (typeof document === "undefined") return;
  const dark =
    current === "dark" || (current === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
}

/** Use `pref` now, and remember it in this browser. */
export function applyAppearance(pref: Appearance): void {
  current = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Blocked storage: it holds for this page.
  }
  if (!following && typeof matchMedia === "function") {
    following = matchMedia("(prefers-color-scheme: dark)");
    following.addEventListener?.("change", paint);
  }
  paint();
}

/** Signed out: forget the account's look; the device decides again. */
export function forgetAppearance(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
  applyAppearanceQuietly("system");
}

function applyAppearanceQuietly(pref: Appearance): void {
  current = pref;
  paint();
}

/** The look in effect, as the person chose it. */
export function currentAppearance(): Appearance {
  return storedAppearance() ?? current;
}
