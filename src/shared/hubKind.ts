// What a hub IS (`identity.hub_kind`, 2026-09-27, Adam): a place's hub — a
// local government or community — or an issue campaign, an organization or
// club, or something else. Structure helps when it fits; it never forces a
// place onto a hub that has none.
//
//   place         a jurisdiction is required: a reference row, or custom
//   issue         a related place is optional (a campaign may be statewide)
//   organization  a related place is optional
//   other         a related place is optional
//
// Unset means `place`: every hub made before the setting existed serves a
// place. `identity.jurisdiction_type` and the governing body belong to place
// hubs only. Shared by the server, the console and the hub UI. Pure.

export type HubKind = "place" | "issue" | "organization" | "other";

export const HUB_KINDS: ReadonlyArray<{ id: HubKind; label: string; hint: string }> = [
  { id: "place", label: "Place", hint: "A local government or community: a county, city, town, school district, neighbourhood." },
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
 * residents and no members (Adam, 2026-10-06).
 */
export function participantNoun(kind: HubKind, count: number): string {
  const one = kind === "place" ? "resident" : kind === "organization" ? "member" : "participant";
  return count === 1 ? one : `${one}s`;
}

/**
 * The byline of someone whose name is not shown — a signed-out viewer's
 * view, or an account with no name: "Resident", "Member", "Participant".
 */
export function personLabel(kind: HubKind): string {
  const noun = participantNoun(kind, 1);
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
  if (kind === "organization") return `I confirm that I am a member of ${names.hub}`;
  return null;
}
