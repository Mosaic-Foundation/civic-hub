// The space-type record (console slice, 2026-11-10): what a kind of Mosaic
// space is called and how its mail reads, in one place, so the console and
// email stop hard-coding "hub". One record today: Civic Hub.
//
// Where it lives, under the seam rule: here in src/shared, a pure module, not
// a table (a table would be a new read across the console/hub seam). Hub code
// (mail) reads it directly. The console (Mosaic-Foundation/mosaic-console) carries its own copy.
//
// The sending ADDRESSES stay the deployment's, because only a domain the
// provider has verified can send (src/services/emailSender.ts): each sender
// here names the hosting setting its address comes from, and the domain that
// setting must be on. Mail is byte-identical to before this record.
//
// Shared by the server and the UI. Pure.

export interface SpaceSender {
  /**
   * The hosting setting holding the address (`Name <addr>` or a bare
   * address). The operator sender's, unset, is the member sender, as before.
   */
  setting: string;
  /** The domain the address is on, verified with the mail provider. */
  domain: string;
}

export interface SpaceType {
  id: string;
  /** "Civic Hub": what a space of this type is called in headings and mail. */
  displayName: string;
  /** "hub", and its plural: the word in running text ("Create a hub"). */
  noun: string;
  nounPlural: string;
  /** Where its spaces live: one label under this domain. */
  domainPattern: string;
  /** Mail to people inside a space: its admins, members and invitees. A hub's own `email.from_address` wins. */
  memberSender: SpaceSender;
  /** Where people inside a space write when the space has not said its own address. */
  supportAddress: string;
  /** Mail to the platform's operators (the console's codes). */
  operatorSender: SpaceSender;
  /** Who maintains the software, as mail names them ("Civic.Social, which maintains the software"). */
  maintainer: string;
  /** The set of email templates its mail is written from. */
  templateSet: string;
}

export const CIVIC_HUB: SpaceType = {
  id: "civic_hub",
  displayName: "Civic Hub",
  noun: "hub",
  nounPlural: "hubs",
  domainPattern: "*.civic.social",
  memberSender: { setting: "RESEND_FROM", domain: "civic.social" },
  supportAddress: "contact@civic.social",
  // mosaic.social once Adam has verified it with the provider; until then the
  // console's codes come from the member sender, as before (2026-11-10).
  operatorSender: { setting: "CIVIC_OPERATOR_MAIL_FROM", domain: "civic.social" },
  maintainer: "Civic.Social",
  templateSet: "civic-hub",
};

/** Every space type, by id. One today. */
export const SPACE_TYPES: Readonly<Record<string, SpaceType>> = { [CIVIC_HUB.id]: CIVIC_HUB };

/** The space type this deployment serves. */
export function currentSpaceType(): SpaceType {
  return CIVIC_HUB;
}

/** Its names, as a page shows them. */
export function spaceTypeView(t: SpaceType = currentSpaceType()): { id: string; display_name: string; noun: string; noun_plural: string } {
  return { id: t.id, display_name: t.displayName, noun: t.noun, noun_plural: t.nounPlural };
}
