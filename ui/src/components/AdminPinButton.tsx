// Pin any item to the right column's card, or unpin it (Adam, 2026-11-18;
// src/services/pins.ts). Admins only; drawn by the archive slot on every
// type's detail page (archiveSlot.tsx), so a type added later has it too.
// Whether the item is pinned now is read from the right column's facts (the
// card lists every pinned item), and they are read again after a change.
// No end date here: a pin stays until it is unpinned.

import { useEffect, useState } from "react";
import { useAuth } from "../context/authState";
import { useAction } from "../hooks/useAction";
import { adminPinProcess, adminUnpinProcess } from "../services/api";
import { loadAsideFacts, onAsideChanged, refreshAside } from "../aside/asideFacts";
import "./AdminArchiveButton.css";

export default function AdminPinButton({ processId }: { processId: string }) {
  const { isAdmin } = useAuth();
  const [pinned, setPinned] = useState<boolean | null>(null);
  const action = useAction("Could not change the pin");

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const read = () =>
      void loadAsideFacts().then((facts) => {
        if (live) setPinned(Boolean(facts?.announcements.some((a) => a.process_id === processId && a.pinned)));
      });
    read();
    const off = onAsideChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [isAdmin, processId]);

  if (!isAdmin || pinned === null) return null;

  async function toggle() {
    const done = await action.run(() => (pinned ? adminUnpinProcess(processId) : adminPinProcess(processId)));
    if (done) {
      setPinned(done.pinned);
      refreshAside();
    }
  }

  return (
    <div className="admin-archive-control" role="region" aria-label="Pin">
      <button
        type="button"
        className="admin-archive-open-btn"
        onClick={toggle}
        disabled={action.busy}
        aria-busy={action.busy}
      >
        {pinned ? "Unpin" : "Pin to the right column"}
      </button>
      {action.error && <p className="form-error">{action.error}</p>}
    </div>
  );
}
