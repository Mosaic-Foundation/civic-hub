// Egregious-slur submission filter — the lightweight, free, no-API civility
// backstop for INSTANT-POST content (comments, Polis statements, word-cloud
// words). This is NOT a general profanity filter and NOT opinion policing.
//
// DESIGN INTENT (Adam, 2026-07-09 — "decorum, not opinion"):
//   - Block ONLY the obvious, unambiguous egregious case: hard slurs (racial,
//     ethnic, homophobic, transphobic, ableist) and explicit sexual content
//     involving minors.
//   - ERR HARD toward NOT blocking. Passionate, blunt, angry-but-civil dissent
//     must always get through. General profanity (damn, hell, ass, "fuck this
//     policy") is deliberately NOT blocked — that is civil speech here.
//   - This is a crude first pass, paired with human admin hide as the backstop
//     and (later) the Perspective API for calibrated hostility scoring. It is
//     expected to MISS clever nastiness; that is an acceptable trade for zero
//     false-positives on civil dissent.
//
// MATCHING: whole-word only (never substring), so "Scunthorpe"/"assess"/
// "class" and similar innocent words can never trip it. A light leetspeak +
// repeated-character normalization catches the most obvious evasions
// ("n1gg3r", "f----t" collapse) without widening to substrings.
//
// This list is intentionally SHORT and reviewable. It is meant to be edited by
// the operator. Reputable open-source lists (e.g. LDNOOBW) were used as a
// reference, but their bulk is general profanity we deliberately exclude.

// The blocked terms, stored in a normalized form (lowercase, letters only).
// Each entry here is matched against a normalized token from the submission.
// Kept deliberately minimal — the unambiguous slurs civil discourse never
// needs. Review and extend with care; every addition risks a false positive.
const BLOCKED_TERMS_RAW: string[] = [
  // Racial / ethnic slurs
  "nigger",
  "nigga",
  "niggers",
  "coon",
  "chink",
  "chinks",
  "gook",
  "gooks",
  "spic",
  "spics",
  "wetback",
  "wetbacks",
  "kike",
  "kikes",
  "beaner",
  "beaners",
  "raghead",
  "ragheads",
  "sandnigger",
  "jigaboo",
  "porchmonkey",
  // Homophobic / transphobic slurs
  "faggot",
  "faggots",
  "fag",
  "fags",
  "dyke",
  "dykes",
  "tranny",
  "trannies",
  "shemale",
  "shemales",
  // Ableist slur
  "retard",
  "retards",
  "retarded",
  // Explicit sexual content involving minors
  "childporn",
];

// Collapse a raw token to a comparable normalized form:
//  - lowercase
//  - map common leetspeak substitutions to letters
//  - drop every non-letter character
//  - collapse runs of 3+ identical letters to 2 (so "niiiigger" -> "niigger"
//    is caught by also trying a fully-deduped form below)
function normalizeToken(token: string): string {
  const leet: Record<string, string> = {
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "@": "a",
    $: "s",
  };
  return token
    .toLowerCase()
    .split("")
    .map((ch) => leet[ch] ?? ch)
    .join("")
    .replace(/[^a-z]/g, "");
}

// A more aggressive form: collapse ALL repeated letters to a single one, so
// "faaaag" and "faag" both reduce to "fag". Used only as a second comparison
// so exact matching stays primary.
function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/g, "$1");
}

const BLOCKED_EXACT = new Set(BLOCKED_TERMS_RAW.map(normalizeToken));
const BLOCKED_COLLAPSED = new Set(
  BLOCKED_TERMS_RAW.map((t) => collapseRepeats(normalizeToken(t))),
);

export interface WordlistCheckResult {
  blocked: boolean;
  /** The offending term (normalized), for logging only — never shown to users. */
  term?: string;
}

/**
 * Returns whether `text` contains a blocked term as a whole word. Tokenizes on
 * any non-letter/non-digit boundary, so slurs separated by spaces, dots, or
 * dashes ("n i g g e r", "n.i.g.g.e.r") are each tested as tokens AND the
 * whole collapsed string is tested once, without ever matching a substring
 * inside a legitimate word.
 */
export function checkWordlist(text: string): WordlistCheckResult {
  if (!text) return { blocked: false };

  // Per-token pass (the common case).
  const tokens = text.split(/[^\p{L}\p{N}@$]+/u);
  for (const raw of tokens) {
    const norm = normalizeToken(raw);
    if (!norm) continue;
    if (BLOCKED_EXACT.has(norm)) return { blocked: true, term: norm };
    const collapsed = collapseRepeats(norm);
    if (BLOCKED_COLLAPSED.has(collapsed)) {
      return { blocked: true, term: norm };
    }
  }

  // Spaced-out evasion pass ("n i g g e r"): normalize the ENTIRE string to a
  // single letter-run and test whether it *equals* a blocked term. Equality
  // (not inclusion) keeps this from firing on ordinary sentences.
  const whole = normalizeToken(text);
  if (BLOCKED_EXACT.has(whole)) return { blocked: true, term: whole };
  if (BLOCKED_COLLAPSED.has(collapseRepeats(whole))) {
    return { blocked: true, term: whole };
  }

  return { blocked: false };
}

/**
 * The message shown to a user whose submission is blocked. Frames it as the
 * Code of Conduct line it is (input validation, "fix this"), names the appeal
 * path, and never repeats the offending term back.
 */
export const WORDLIST_BLOCK_MESSAGE =
  "This can't be posted because it contains a slur our Code of Conduct doesn't allow. " +
  "Strong disagreement is welcome here — attacks on people for who they are are not. " +
  "If you believe this was blocked in error, email contact@civic.social.";

/**
 * Convenience guard used at submission points. Throws an Error with the
 * user-facing block message when `text` is blocked; otherwise returns.
 * Controllers surface the thrown message as a 400.
 */
export function assertPassesWordlist(text: string): void {
  const result = checkWordlist(text);
  if (result.blocked) {
    // Log the term for the operator; the thrown message never includes it.
    console.warn(`[wordlist] blocked submission containing "${result.term}"`);
    throw new Error(WORDLIST_BLOCK_MESSAGE);
  }
}
