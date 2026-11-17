// Where a brand-new account lands: the hub's word cloud, when the hub names
// one. Word clouds' contribution to sign-up (`contributes.afterSignUp`, kernel
// step 3); the kernel asks it only while Word clouds is on, so a switched-off
// cloud is never the first thing a new member sees. Moved from the hub's
// config/pluginRules.ts (onboardingTarget). Pure.

/** `back` is the page they signed up on, a local path the kernel has already checked (or null). */
export function onboardingStop(onboardingId: string | undefined | null, back?: string | null): string | null {
  const id = onboardingId?.trim();
  if (!id) return null;
  // Where the new account was when it signed up (review R24): the word
  // cloud's Skip and Continue go back there, not to the home page.
  const ret = back && back !== "/" ? `&return=${encodeURIComponent(back)}` : "";
  return `/wordcloud/${encodeURIComponent(id)}?onboarding=1${ret}`;
}
