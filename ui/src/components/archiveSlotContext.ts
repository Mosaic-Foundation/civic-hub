// The archive slot's context and the hook DetailActions uses to take the
// control into its own row (archiveSlot.tsx says why). Apart from the
// components so fast refresh keeps working.

import { createContext, useContext, useEffect } from "react";

export interface ArchiveSlot {
  type: string;
  id: string;
  /** A page's own DetailActions took the control; returns its release. */
  claim(): () => void;
  /** A page that draws its own pin control (the announcement's admin bar); returns its release. */
  ownPin(): () => void;
  /** Whether the page draws its own pin control. */
  pinOwned: boolean;
}

export const ArchiveSlotContext = createContext<ArchiveSlot | null>(null);

/** For DetailActions: take the slot's control into the page's own row. */
export function useClaimArchiveSlot(): boolean {
  const slot = useContext(ArchiveSlotContext);
  useEffect(() => slot?.claim(), [slot]);
  return slot !== null;
}

/**
 * For a page that draws its own Pin control: the slot's Pin button (any
 * item, 2026-11-18) stays out, so the page shows one.
 */
export function useOwnPinControl(): void {
  const slot = useContext(ArchiveSlotContext);
  const ownPin = slot?.ownPin;
  useEffect(() => ownPin?.(), [ownPin]);
}
