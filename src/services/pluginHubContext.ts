// hubContext(): what a package may know about the hub in scope (Events 2, E3):
// what it calls itself, the address its pages are at, and its clock. Public
// facts all three: the name and the zone are public settings, the address is
// where anyone reaches it. Kernel step 1 adds the scope it serves and what it
// calls the people taking part, public both. Read per call, so a package never holds one hub's
// answer while serving another.

import { getSettingSync, hubDisplayNameSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import { hubKindOf } from "../shared/hubKind.js";
import { resolveTerm, type KernelTerm } from "../shared/spaceProfile.js";
import { currentSpaceType } from "../shared/spaceTypes.js";
import { civicPlaceShortName, defaultJurisdiction } from "../config/hub.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { hubTimeZone } from "./hubTimeZone.js";

export interface HubContext {
  /** What the hub calls itself (`identity.name`, else its registry name). */
  name: string;
  /** The origin its pages are at, no trailing slash: links in a calendar file or a message. */
  baseUrl: string;
  /** Its IANA time zone: `identity.timezone`, else its place's, else "UTC" (src/services/hubTimeZone.ts). */
  timeZone: string;
  /**
   * The scope it serves, as an event's `jurisdiction` carries it: a place code
   * on a Civic Hub ("us-va-floyd"), else "local" (the kernel's spacePlace,
   * docs/kernel/SURFACE.md).
   */
  place: string;
  /**
   * The place it serves in running text ("Floyd County"), or null where it
   * serves none: for a sentence ("Floyd County Government"), never a key.
   */
  placeName: string | null;
  /**
   * What the people taking part are called, for `count` of them: "resident",
   * "members", or the hub's own word (`copy.resident_noun`). Read when called, for the hub in scope then.
   */
  participantNoun(count: number): string;
  /**
   * A kernel word (docs/KERNEL.md §3), for `count` of them: the hub's own
   * word, else the space type's profile ("resident", "official", "hub" on a
   * Civic Hub), else the kernel's neutral word. `participantNoun(n)` is
   * `term("member", n)`.
   */
  term(term: KernelTerm, count?: number): string;
}

/** A kernel word for the hub in scope (hubContext().term). */
export function term(t: KernelTerm, count = 1): string {
  const own = t === "member" ? getSettingSync(KEYS.COPY_RESIDENT_NOUN) : null;
  return resolveTerm(t, currentSpaceType().profile, { kind: hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), own }, count);
}

export function hubContext(): HubContext {
  return {
    name: hubDisplayNameSync(),
    baseUrl: uiBaseUrl(),
    timeZone: hubTimeZone(),
    place: defaultJurisdiction(),
    placeName: civicPlaceShortName(),
    participantNoun: (count) => term("member", count),
    term,
  };
}
