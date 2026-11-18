// Pin any item to the right column's card, or unpin it (Adam, 2026-11-18;
// src/services/pins.ts). Admins only, while the hub's Pinning switch is on;
// drawn by the archive slot on every type's detail page (archiveSlot.tsx), so
// a type added later has it too. Whether the item is pinned now is read from
// the right column's facts (the card lists every pinned item), and they are
// read again after a change. Pinning asks for an optional end date, as
// Admin → Pinned and Admin → Announcements do.

import { useEffect, useState } from "react";
import { useAuth } from "../context/authState";
import { useAction } from "../hooks/useAction";
import { useHub } from "../config/hub";
import { adminPinProcess, adminUnpinProcess } from "../services/api";
import { loadAsideFacts, onAsideChanged, refreshAside } from "../aside/asideFacts";
import { dayFromToday, endOfDay } from "./boardDates";
import "./AdminArchiveButton.css";

export default function AdminPinButton({ processId }: { processId: string }) {
  const { isAdmin } = useAuth();
  const hub = useHub();
  const on = isAdmin && hub.plugins.enabled("pinning");
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [until, setUntil] = useState("");
  const action = useAction("Could not change the pin");

  useEffect(() => {
    if (!on) return;
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
  }, [on, processId]);

  if (!on || pinned === null) return null;

  async function change(pin: boolean) {
    const done = await action.run(() =>
      pin ? adminPinProcess(processId, endOfDay(until, hub.timeZone)) : adminUnpinProcess(processId),
    );
    if (done) {
      setPinned(done.pinned);
      setAsking(false);
      setUntil("");
      refreshAside();
    }
  }

  return (
    <div className="admin-archive-control" role="region" aria-label="Pin">
      {asking ? (
        <form
          className="admin-archive-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            void change(true);
          }}
        >
          <label className="admin-archive-label">
            Pin it to the right column until <span className="optional">(optional)</span>
            <input
              className="admin-archive-reason-input"
              type="date"
              value={until}
              min={dayFromToday(0, hub.timeZone)}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <p className="admin-archive-note">Without a date it stays until you unpin it.</p>
          <div className="admin-archive-actions">
            <button type="submit" className="admin-archive-confirm-btn" disabled={action.busy} aria-busy={action.busy}>
              {action.busy ? "Pinning…" : "Pin"}
            </button>
            <button type="button" className="admin-archive-cancel-btn" onClick={() => setAsking(false)} disabled={action.busy}>
              Cancel
            </button>
          </div>
          {action.error && <p className="form-error">{action.error}</p>}
        </form>
      ) : (
        <>
          <button
            type="button"
            className="admin-archive-open-btn"
            onClick={() => (pinned ? void change(false) : setAsking(true))}
            disabled={action.busy}
            aria-busy={action.busy}
          >
            {pinned ? "Unpin" : "Pin to the right column"}
          </button>
          {action.error && <p className="form-error">{action.error}</p>}
        </>
      )}
    </div>
  );
}
