// The words a hub shows before anyone has written its own (2026-10-07, review
// R17, R19, R45): the welcome strip, the tagline, the intro pop-up, the beta
// bar — each worded by the hub's kind (src/shared/hubKind.ts) and, for a
// place hub, its type of place (src/shared/jurisdictionType.ts). A town says
// town government; an organization or a campaign is not offered a government.
//
// Every default here is a fallback: the hub's own `copy.*` / `identity.*`
// setting always wins. Shared by the server and the hub UI. Pure. Names no
// place: the names come in as arguments.

import { participantNoun, type HubKind } from "./hubKind.js";
import { isJurisdictionType, type JurisdictionType } from "./jurisdictionType.js";

export interface HubCopyContext {
  kind: HubKind;
  /** `identity.jurisdiction_type`, as stored; unknown or unset reads as none. */
  jurisdictionType?: string | null;
  /** The hub's display name. */
  hubName: string;
  /** `copy.resident_noun`, when the hub has named its people. */
  residentNoun?: string | null;
}

/**
 * What a place hub follows: "county government", "town government", "the
 * school district"; "local government" when the type is unknown or other.
 */
export function governmentPhrase(jurisdictionType: string | null | undefined): string {
  const type: JurisdictionType | null = isJurisdictionType(jurisdictionType) ? jurisdictionType : null;
  if (type === "school_district") return "the school district";
  if (!type || type === "other") return "local government";
  return `${type} government`;
}

/**
 * A proper name as it reads in running text, with "the" where English wants
 * one (review R19, R40): "the Town of Example", "the Example School
 * District", "the Example Tenants Association", "the Example County Civic
 * Hub" — but "Example County", "Exampleville", "Fair Votes Now". A name that
 * already starts with "The" is left as it is.
 *
 * `capital` gives "The …" for the start of a sentence.
 */
export function theName(name: string, capital = false): string {
  const n = name.trim();
  if (!n || /^the\s/i.test(n)) return capital && n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
  return needsArticle(n) ? `${capital ? "The" : "the"} ${n}` : n;
}

/** The rule behind theName(): "<Kind> of …", a district, or a body's name. */
export function needsArticle(name: string): boolean {
  const n = name.trim();
  if (/^(town|city|village|borough|county|township|parish|municipality|district|commonwealth|state|city and county)\s+of\s/i.test(n)) return true;
  if (/\bdistrict\b/i.test(n)) return true;
  return /\b(hub|association|campaign|coalition|project|network|alliance|league|society|foundation|committee|council|board|union|cooperative|co-op|club|collective|partnership|initiative|movement|caucus|federation|institute|center|centre)$/i.test(n);
}

/**
 * Fill a sample text's three placeholders (src/services/sampleTemplates.ts),
 * giving the place its article (review R19): "should the Town of Example
 * take first?", and "The Town of Example is updating…" at the start of a
 * sentence. Shared so the console's preview reads like the seeded card.
 */
export function fillSampleText(
  text: string,
  names: { HUB_NAME: string; JURISDICTION: string; GOVERNING_BODY: string },
): string {
  return text.replace(/\{(HUB_NAME|JURISDICTION|GOVERNING_BODY)\}/g, (_m, k: keyof typeof names, offset: number) => {
    if (k !== "JURISDICTION") return names[k];
    const before = text.slice(0, offset);
    const sentenceStart = before.trim() === "" || /[.!?]\s+$/.test(before) || /\n\s*$/.test(before);
    // "the {JURISDICTION}" in a template already has its article.
    if (/\bthe\s+$/i.test(before)) return names[k];
    return theName(names[k], sentenceStart);
  });
}

/**
 * The pill on a vote's brief, worded for the hub (Adam, 2026-10-07): "Brief
 * to the Supervisors", "Brief to the Selectboard"; plain "Brief" on a hub
 * with no governing body. A brief from another kind of process keeps the
 * classifier's own pill ("Proposal results"), passed as `fallback`.
 */
export function briefPillFor(sourceType: string | undefined, boardShort: string, fallback: string): string {
  if (sourceType !== "civic.vote") return fallback;
  return boardShort.trim() ? `Brief to the ${boardShort.trim()}` : "Brief";
}

/** The heading of the home page's welcome strip. */
export function welcomeStripTitle(ctx: HubCopyContext): string {
  return `Welcome to ${theName(ctx.hubName)}`;
}

/**
 * The welcome strip's paragraph when the hub has written none
 * (`copy.welcome_strip`). The UI adds the feedback pointer after it.
 */
export function defaultWelcomeStrip(ctx: HubCopyContext): string {
  switch (ctx.kind) {
    case "place":
      return `A new space to follow ${governmentPhrase(ctx.jurisdictionType)}, raise the issues that matter, and decide together.`;
    case "organization":
      return `A new space for ${participantNoun(ctx.kind, 2, ctx.residentNoun)} to raise the issues that matter and decide together.`;
    case "issue":
      return `A new space for everyone working on this cause to raise what matters and decide together.`;
    default:
      return `A new space to raise the issues that matter and decide together.`;
  }
}

/** The tagline under the hub's name when the hub has written none (`identity.tagline`). */
export function defaultTagline(ctx: HubCopyContext): string {
  const people = participantNoun(ctx.kind, 2, ctx.residentNoun);
  if (ctx.kind === "place") {
    return `Stay informed on ${governmentPhrase(ctx.jurisdictionType)}, raise the issues that matter, work on projects together, and see where our community stands.`;
  }
  return `Raise the issues that matter, work on projects together, and see where our ${people} stand.`;
}

/** The first-visit pop-up's paragraph when the hub has written none (`copy.intro_body`). */
export function defaultIntroBody(ctx: HubCopyContext): string {
  const people = participantNoun(ctx.kind, 2, ctx.residentNoun);
  const Cap = people.charAt(0).toUpperCase() + people.slice(1);
  if (ctx.kind === "place") {
    return `This is where ${people} keep up with ${governmentPhrase(ctx.jurisdictionType)}, raise topics that matter, help make sense of issues together, and have conversations to see where the community stands.`;
  }
  return `${Cap} raise topics that matter here, help make sense of issues together, and have conversations to see where everyone stands.`;
}

/**
 * The beta bar when the hub has written none (`copy.beta_banner`). It says
 * the content is sample content only while some is left (review R45): after
 * removal that sentence would be false.
 */
export function defaultBetaBanner(ctx: HubCopyContext & { hasSamples: boolean }): string {
  const lead = `You're browsing the ${ctx.hubName} beta.`;
  return ctx.hasSamples
    ? `${lead} Content marked Sample is illustrative, not real community input.`
    : `${lead} It's early, and things will change as we build it with you.`;
}
