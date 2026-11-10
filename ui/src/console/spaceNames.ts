// What a space is called in the console's headings ("Hubs", "Create a hub"),
// from the space-type record (src/shared/spaceTypes.ts) as GET
// /control/session gives it: the console reads it through the control API,
// never from hub code (the seam rule, console slice 2026-11-10).

import { createContext, useContext } from "react";

export interface SpaceNames {
  display_name: string;
  noun: string;
  noun_plural: string;
}

/** Until the session answers: the words the console has always used. */
export const DEFAULT_SPACE_NAMES: SpaceNames = { display_name: "Civic Hub", noun: "hub", noun_plural: "hubs" };

export const SpaceNamesContext = createContext<SpaceNames>(DEFAULT_SPACE_NAMES);

export function useSpaceNames(): SpaceNames {
  return useContext(SpaceNamesContext);
}

/** "hubs" → "Hubs". */
export function capital(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}
