// Which of the admin rail's groups are open (ADR-018's Nov 7 amendment): the
// group holding the page you're on opens, the others start closed, and each
// open or close is remembered in this browser, so the rail looks the way you
// left it next time. The desktop rail and the phone's drawer share it.
//
// Browser storage only, and best effort: blocked storage just means every
// visit starts from the page's own group.

import { useCallback, useEffect, useState } from "react";
import type { AdminNavGroupId } from "./useAdminNav";

export const RAIL_GROUPS_KEY = "civic.admin-rail.open";

type OpenState = Partial<Record<AdminNavGroupId, boolean>>;

function readStored(): OpenState {
  try {
    const raw = window.localStorage.getItem(RAIL_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: OpenState = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean" && (k === "review" || k === "community" || k === "settings")) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function store(state: OpenState): void {
  try {
    window.localStorage.setItem(RAIL_GROUPS_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the rail still works, it just doesn't remember.
  }
}

export function useRailGroups(currentGroup: AdminNavGroupId | null): {
  isOpen: (id: AdminNavGroupId) => boolean;
  toggle: (id: AdminNavGroupId) => void;
} {
  const [open, setOpen] = useState<OpenState>(() => {
    const stored = readStored();
    return currentGroup ? { ...stored, [currentGroup]: true } : stored;
  });

  // Arriving at a page in a closed group opens it (adjusted while rendering,
  // React's pattern for state that follows a prop).
  const [arrivedIn, setArrivedIn] = useState(currentGroup);
  if (currentGroup !== arrivedIn) {
    setArrivedIn(currentGroup);
    if (currentGroup && !open[currentGroup]) setOpen({ ...open, [currentGroup]: true });
  }

  useEffect(() => store(open), [open]);

  const toggle = useCallback((id: AdminNavGroupId) => setOpen((o) => ({ ...o, [id]: !o[id] })), []);
  const isOpen = useCallback((id: AdminNavGroupId) => open[id] ?? false, [open]);
  return { isOpen, toggle };
}
