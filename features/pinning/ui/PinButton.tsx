// Pin any item to the Pinned card, or unpin it (Adam, 2026-11-18; the
// Pinning plugin's since kernel step 4). Drawn in the action row at the foot
// of every type's page (ui/src/features.ts `itemAction`), so a type added
// later has it too, for whoever the space lets pin (Settings → Plugins →
// Pinning). Pinning asks for an optional end date and whether it is urgent,
// as Admin → Pinned does.

import { useEffect, useState } from "react";
import { useAction } from "../../../ui/src/hooks/useAction";
import { useHub } from "../../../ui/src/config/hub";
import { dayFromToday, endOfDay } from "../../../ui/src/components/boardDates";
import { getPin, loadBoard, onBoardChanged, pinItem, refreshBoard, unpinItem, type PinView } from "./api";
import "../../../ui/src/components/AdminArchiveButton.css";

/** Whether the reader may pin here: the card's answer, read again after a change. */
export function useCanPin(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      void loadBoard().then((b) => {
        if (live) setCan(Boolean(b?.can_pin));
      });
    read();
    const off = onBoardChanged(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  return can;
}

export default function PinButton({ processId }: { processId: string }) {
  const hub = useHub();
  const can = useCanPin();
  const [pin, setPin] = useState<PinView | null>(null);
  const [asking, setAsking] = useState(false);
  const [until, setUntil] = useState("");
  const [urgent, setUrgent] = useState(false);
  const action = useAction("Could not change the pin");

  useEffect(() => {
    if (!can) return;
    let live = true;
    getPin(processId)
      .then((p) => {
        if (live) setPin(p);
      })
      .catch(() => {
        if (live) setPin(null);
      });
    return () => {
      live = false;
    };
  }, [can, processId]);

  if (!can || pin === null) return null;

  async function change(on: boolean) {
    const done = await action.run(() =>
      on ? pinItem(processId, { pinned_until: endOfDay(until, hub.timeZone), urgent }) : unpinItem(processId),
    );
    if (done) {
      setPin(done);
      setAsking(false);
      setUntil("");
      setUrgent(false);
      refreshBoard();
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
            Keep it on the Pinned card until <span className="optional">(optional)</span>
            <input
              className="admin-archive-reason-input"
              type="date"
              value={until}
              min={dayFromToday(0, hub.timeZone)}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <p className="admin-archive-note">Without a date it stays until it is unpinned.</p>
          <label className="admin-archive-label">
            <span>
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
            </span>
          </label>
          <p className="admin-archive-note">
            An urgent pin is listed first and shown as a line across the top of every page. For a fire ban, a road
            closure, a boil-water notice.
          </p>
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
            onClick={() => (pin.pinned ? void change(false) : setAsking(true))}
            disabled={action.busy}
            aria-busy={action.busy}
          >
            {pin.pinned ? "Unpin" : "Pin"}
          </button>
          {action.error && <p className="form-error">{action.error}</p>}
        </>
      )}
    </div>
  );
}
