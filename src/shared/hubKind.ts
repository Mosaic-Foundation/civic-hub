// What a hub IS (`identity.hub_kind`, 2026-09-27, Adam): a jurisdiction's hub
// (the id stays `place`), a neighbourhood or association, an issue campaign,
// an organization or club, or something else. Structure helps when it fits;
// it never forces a place onto a hub that has none.
//
//   place         a jurisdiction is required
//   community     a neighbourhood, a homeowners association, a tribal nation,
//                 an association: its location is optional, from the list or
//                 typed when the list doesn't have it (2026-10-30)
//   issue         a location is optional (a campaign may be statewide)
//   organization  a location is optional
//   other         a location is optional
//
// Unset means `place`: every hub made before the setting existed serves a
// place. `identity.jurisdiction_type` and the governing body belong to place
// hubs only. Shared by the server, the console and the hub UI. Pure.

export type HubKind = "place" | "community" | "issue" | "organization" | "other";

export const HUB_KINDS: ReadonlyArray<{ id: HubKind; label: string; hint: string }> = [
  { id: "place", label: "Jurisdiction", hint: "A local government: a county, city, town or school district." },
  {
    id: "community",
    label: "Neighbourhood or association",
    hint: "A neighbourhood, a homeowners association, a tribal nation or an association: people who share a place and decide together.",
  },
  { id: "issue", label: "Issue campaign", hint: "A cause that crosses places, such as a ranked-choice voting effort." },
  { id: "organization", label: "Organization or club", hint: "A group with members, wherever they live." },
  { id: "other", label: "Other", hint: "Anything else." },
];

export const DEFAULT_HUB_KIND: HubKind = "place";

export function isHubKind(value: unknown): value is HubKind {
  return typeof value === "string" && HUB_KINDS.some((k) => k.id === value);
}

/** The stored value, read leniently: unset or unknown is a place hub. */
export function hubKindOf(value: string | null | undefined): HubKind {
  return isHubKind(value) ? value : DEFAULT_HUB_KIND;
}

/**
 * What the people taking part are called: residents of a place hub, members
 * of an organization, participants anywhere else — a campaign has no
 * residents and no members (Adam, 2026-10-06). A hub may name them itself
 * (`copy.resident_noun`, wired in 2026-10-07: "neighbor", "student"); pass it
 * as `custom`, singular, and the plural is formed from it.
 */
export function participantNoun(kind: HubKind, count: number, custom?: string | null): string {
  const own = custom?.trim().toLowerCase();
  const one = own || (kind === "place" ? "resident" : kind === "organization" || kind === "community" ? "member" : "participant");
  return count === 1 ? one : pluralNoun(one);
}

/** "resident" → "residents", "family" → "families", "class" → "classes". */
export function pluralNoun(one: string): string {
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(one)) return `${one}es`;
  return `${one}s`;
}

/**
 * The byline of someone whose name is not shown — a signed-out viewer's
 * view, or an account with no name: "Resident", "Member", "Participant",
 * or the hub's own noun.
 */
export function personLabel(kind: HubKind, custom?: string | null): string {
  const noun = participantNoun(kind, 1, custom);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * What a new account confirms on joining, before "I have read and agree to
 * the Terms…" (Adam, 2026-10-06): residence for a place hub, membership for
 * an organization. An issue campaign or another kind of hub asks neither —
 * anyone may take part — so the line is null and the sentence starts at "I".
 */
export function affiliationClause(kind: HubKind, names: { place: string; hub: string }): string | null {
  if (kind === "place") return `I confirm that I am a resident of ${names.place}`;
  if (kind === "organization" || kind === "community") return `I confirm that I am a member of ${names.hub}`;
  return null;
}
