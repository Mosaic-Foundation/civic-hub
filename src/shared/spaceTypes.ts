// The space-type record (console slice, 2026-11-10): what a kind of Mosaic
// space is called and how its mail reads, in one place, so the console and
// email stop hard-coding "hub".
//
// The deployment picks its space type in config/plugins.json ("space"; kernel
// step 4), and `npm run plugins:sync` names that type's record in
// config/spaceType.ts, which this file alone reads (eslint). The Civic Hub's
// is spaces/civic/type.ts. A deployment with no space type gets the kernel's
// neutral record below. Not a table, under the seam rule (a table would be a
// new read across the console/hub seam). The console
// (Mosaic-Foundation/mosaic-console) carries its own copy.
//
// The sending ADDRESSES stay the deployment's, because only a domain the
// provider has verified can send (src/services/emailSender.ts): each sender
// here names the hosting setting its address comes from, and the domain that
// setting must be on. Mail is byte-identical to before this record.
//
// Shared by the server and the UI. Pure.

import { KERNEL_ROLES, NEUTRAL_TERMS, type SpaceProfile } from "./spaceProfile.js";
import { SPACE_TYPE } from "../../config/spaceType.js";

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
  /** What it calls the kernel's roles and words (kernel step 2). Its `space` names the noun above. */
  profile: SpaceProfile;
  /**
   * Its plugins (kernel rule 6): each listed plugin is required (on, and a
   * space's admins cannot switch it off), on by default, or off by default.
   * A plugin it does not list keeps the plugin's own default. By plugin id.
   */
  plugins?: { required?: readonly string[]; on?: readonly string[]; off?: readonly string[] };
}

/** What the space type says of one plugin, or null when it leaves it to the plugin's own default. */
export function spacePluginRule(id: string, t: SpaceType = currentSpaceType()): "required" | "on" | "off" | null {
  const p = t.plugins;
  if (p?.required?.includes(id)) return "required";
  if (p?.on?.includes(id)) return "on";
  if (p?.off?.includes(id)) return "off";
  return null;
}

/** Whether the space type requires the plugin: always on, no off switch for a space's admins. */
export function pluginRequired(id: string, t: SpaceType = currentSpaceType()): boolean {
  return spacePluginRule(id, t) === "required";
}

/** The kernel's own record, for a deployment with no space type: neutral words, the deployment's senders. */
export const NEUTRAL_SPACE_TYPE: SpaceType = {
  id: "space",
  displayName: "Mosaic space",
  noun: NEUTRAL_TERMS.space,
  nounPlural: `${NEUTRAL_TERMS.space}s`,
  domainPattern: "*",
  memberSender: { setting: "RESEND_FROM", domain: "" },
  supportAddress: "",
  operatorSender: { setting: "CIVIC_OPERATOR_MAIL_FROM", domain: "" },
  maintainer: "the Mosaic Foundation",
  templateSet: "neutral",
  profile: {
    id: "neutral",
    space: { one: NEUTRAL_TERMS.space, many: `${NEUTRAL_TERMS.space}s` },
    roles: Object.fromEntries(KERNEL_ROLES.map((r) => [r, r])) as SpaceProfile["roles"],
    terms: {},
  },
};

const CURRENT: SpaceType = SPACE_TYPE ?? NEUTRAL_SPACE_TYPE;

/** Every space type this deployment knows, by id: the one it serves. */
export const SPACE_TYPES: Readonly<Record<string, SpaceType>> = { [CURRENT.id]: CURRENT };

/** The space type this deployment serves (config/plugins.json's "space"). */
export function currentSpaceType(): SpaceType {
  return CURRENT;
}

/** Its names, as a page shows them. */
export function spaceTypeView(t: SpaceType = currentSpaceType()): { id: string; display_name: string; noun: string; noun_plural: string } {
  return { id: t.id, display_name: t.displayName, noun: t.noun, noun_plural: t.nounPlural };
}
