// The space type's palette (kernel step 3): the colour families, card kinds and
// digest sections its process types share. Plain data the UI and the server
// both read, so the kernel's feed, theme and digest name no type themselves.
//
// The hosting layer names the palette in config/spacePalette.ts beside the
// space type (config/space.ts); this is the one file of the kernel that reads
// it (eslint `civic/package-boundary`). A deployment with no space type has no
// palette: its cards are the kernel's neutral colour, and a package's own card
// kinds (`feed.kinds`, A5) still bring their colours and sections.

import { PALETTE } from "../../config/spacePalette.js";

/** A colour family the space type's cards wear. */
export interface SpaceColor {
  /** The key a card rule's `color` names ("vote"); the UI's `--type-<key>-*` tokens. */
  key: string;
  /** Offered in Settings → Theme, in this order. */
  theme?: {
    label: string;
    /** The default hue. */
    hue: string;
    /** The hub's base colour it follows when the admin changes that colour and not this one. */
    follows?: "primary" | "accent";
    /** Its picked hue also drives the older `--pill-<key>-*` names. */
    legacyPill?: boolean;
    /** Its picked hue also sets `--type-<key>-rule` and `--type-<key>-wash` (a brief's page). */
    ruleAndWash?: boolean;
  };
  /** Its pill in the email digest (emails cannot read CSS variables). */
  email?: { bg: string; fg: string };
}

/** A card kind the space type's process types make. */
export interface SpaceKind {
  kind: string;
  /** The digest section it is listed under. */
  section: string;
  /** Its place in the digest: lower first; equal places sort by time together. */
  order: number;
  /** Its card reads more than its event (titles, counts, images): the feed batches its process metadata. */
  meta?: boolean;
  /** The word a card adds beside the type pill ("Results"). */
  note?: string;
  /** Its card's metadata line names what it answers, set apart (an official's response). */
  context?: boolean;
}

/** A section of the email digest. */
export interface SpaceSection {
  key: string;
  heading: string;
  /** After the packages' own sections (A5), at the end. */
  last?: boolean;
}

export interface SpacePalette {
  colors: readonly SpaceColor[];
  kinds: readonly SpaceKind[];
  /** In the digest's order. */
  sections: readonly SpaceSection[];
  /** Where a kind with no section of its own is listed. */
  fallbackSection: string;
}

const EMPTY: SpacePalette = { colors: [], kinds: [], sections: [], fallbackSection: "other" };

/** The deployment's palette, or an empty one. */
export const SPACE_PALETTE: SpacePalette = PALETTE ?? EMPTY;

/** The space type's card kinds, by kind. */
export const SPACE_KINDS: ReadonlyMap<string, SpaceKind> = new Map(SPACE_PALETTE.kinds.map((k) => [k.kind, k]));

/** The space type's colour keys. */
export const SPACE_COLOR_KEYS: ReadonlySet<string> = new Set(SPACE_PALETTE.colors.map((c) => c.key));
