// A place in the left column a page may draw its own navigation into (design
// pass, 2026-10-29): Hub settings puts its section rail there in the
// left-column layout, under the column's "Hub settings" item, so the admin
// sees one rail rather than the column and a second rail beside it. The page
// keeps owning the rail (its unsaved-changes dots and the leave-anyway
// question); it is only drawn elsewhere, through a portal. Null in the top
// layout and on phones, where the page draws the rail itself.

import { createContext, useContext } from "react";

export interface ColumnSlot {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

export const ColumnSlotContext = createContext<ColumnSlot>({ slot: null, setSlot: () => {} });

export function useColumnSlot(): HTMLElement | null {
  return useContext(ColumnSlotContext).slot;
}
