// Admin → Community → Pinned (Adam, 2026-11-18; src/services/pins.ts): every
// item on the Pinned card, of any type, and every urgent
// announcement, in the card's order (urgent first). Unpin, or change a pin's
// end date, without going to each item. The hub's own page, there while the
// Pinning switch is on, whatever plugins are; urgent is the Announcements
// plugin's, set on its form.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import { adminListPins, adminPinProcess, adminUnpinProcess, type PinnedRow } from "../services/api";
import { Button, Group, StatusChip } from "../kit";
import { dayFromToday, dayOf, endOfDay, shortDay } from "../components/boardDates";
import { refreshAside } from "../aside/asideFacts";
import "./AdminPinned.css";

type Pins = { items: PinnedRow[]; pinned_count: number; pinned_max: number };

export default function AdminPinned() {
  const { isAdmin, loading: authLoading } = useAuth();
  const hub = useHub();
  const tz = hub.timeZone;
  const { data, loading, error, reload } = useApi<Pins>(!authLoading && isAdmin ? "admin/pins" : null, () => adminListPins());
  // The row whose end date is being changed, and the day picked.
  const [editing, setEditing] = useState<string | null>(null);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!authLoading && !isAdmin) {
    return (
      <div className="page admin-page">
        <p>Admin access required.</p>
      </div>
    );
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
      setEditing(null);
      setUntil("");
      refreshAside();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.items ?? [];

  return (
    <div className="page admin-page admin-pinned-page">
      <h1 className="kit-page-title">Pinned</h1>
      <p className="admin-page-description kit-page-lede">
        Everything on the Pinned card, of any kind. Only admins pin. Pin an item from its own page: the Pin button sits
        at the bottom, beside Archive. A pin stays until you unpin it or its end date passes. Urgent
        announcements are listed first; whoever posts an announcement marks it urgent on its form. Pinning doesn't move
        anything in the feed and isn't sent to the Fediverse.
      </p>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {loading && !data && <p className="kit-note">Loading…</p>}
      {error && <p className="form-error">{error.message}</p>}

      {data && (
        <Group
          heading="On the card now"
          description={`${data.pinned_count} of ${data.pinned_max} pinned. The card shows three and scrolls for the rest; urgent ones come first.`}
        >
          {rows.length === 0 ? (
            <p className="kit-note">Nothing is pinned or urgent. The card shows the latest announcements.</p>
          ) : (
            <ul className="admin-pinned-list">
              {rows.map((row) => (
                <li key={row.id} className="admin-pinned-row">
                  <div className="admin-pinned-text">
                    <Link to={row.url} className="admin-pinned-title">
                      {row.title}
                    </Link>
                    <span className="admin-pinned-marks">
                      {row.urgent && <StatusChip tone="alert">Urgent</StatusChip>}
                      {row.urgent && row.urgent_until && <span>until {shortDay(row.urgent_until, tz)}</span>}
                      {row.pinned && (
                        <span>Pinned{row.pinned_until ? ` until ${shortDay(row.pinned_until, tz)}` : ", no end date"}</span>
                      )}
                    </span>
                    <span className="admin-pinned-meta">{row.type_label}</span>
                  </div>
                  {row.pinned && (
                    <div className="admin-pinned-actions">
                      {editing === row.id ? (
                        <form
                          className="admin-pinned-pin-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(row.id, () => adminPinProcess(row.id, endOfDay(until, tz)));
                          }}
                        >
                          <label className="admin-pinned-until">
                            <span>
                              Until <span className="optional">(empty: no end date)</span>
                            </span>
                            <input
                              className="form-input"
                              type="date"
                              value={until}
                              min={dayFromToday(0, tz)}
                              onChange={(e) => setUntil(e.target.value)}
                            />
                          </label>
                          <Button size="sm" variant="primary" type="submit" disabled={busy === row.id}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            disabled={busy === row.id}
                            onClick={() => {
                              setEditing(row.id);
                              setUntil(dayOf(row.pinned_until, tz));
                              setActionError(null);
                            }}
                          >
                            Change end date
                          </Button>
                          <Button size="sm" disabled={busy === row.id} onClick={() => act(row.id, () => adminUnpinProcess(row.id))}>
                            Unpin
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Group>
      )}
    </div>
  );
}
