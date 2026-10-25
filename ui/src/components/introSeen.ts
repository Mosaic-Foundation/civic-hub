// Whether this browser has seen the first-visit popup (split from IntroPopup.tsx).

const STORAGE_KEY = "seen_intro_popup";

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // localStorage unavailable — popup may reappear, acceptable degradation
  }
}

/**
 * Slice 10 — clear the "seen" flag so the popup reappears on the next
 * visit. Used by the About page's "Show me the welcome again" link.
 * Doesn't force-reopen the popup right then; that would be jarring
 * after an explicit click.
 */
export function clearIntroSeen(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op — same fallback as markIntroSeen.
  }
}
