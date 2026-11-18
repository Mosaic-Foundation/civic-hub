// The archive slot's context and the hook DetailActions uses to take the
// control into its own row (archiveSlot.tsx says why). Apart from the
// components so fast refresh keeps working.

import { createContext, useContext, useEffect } from "react";

export interface ArchiveSlot {
  type: string;
  id: string;
  /** A page's own DetailActions took the control; returns its release. */
  claim(): () => void;
}

export const ArchiveSlotContext = createContext<ArchiveSlot | null>(null);

/** For DetailActions: take the slot's control into the page's own row. */
export function useClaimArchiveSlot(): boolean {
  const slot = useContext(ArchiveSlotContext);
  useEffect(() => slot?.claim(), [slot]);
  return slot !== null;
}
