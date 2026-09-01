/**
 * Routes a logged-out visitor can reach during beta mode without going
 * through the front door: standalone info/legal pages that are linked from
 * the sign-up consent line, the re-acceptance modal and the footer.
 *
 * Shared by Nav (which leaves these links ungated) and App (which never
 * mounts BetaWelcomeDialog over them — the consent-line links open in a
 * new tab that carries no session preview flag, so without this gate the
 * welcome dialog would re-appear on top of the Terms/Privacy page the
 * visitor was trying to read).
 */
export const BETA_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/welcome",
  "/about",
  "/feedback",
  "/code-of-conduct",
  "/privacy",
  "/terms",
]);
