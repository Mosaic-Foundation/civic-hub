// Admin → Announcements (Adam, 2026-11-15; src/shared/announcementBoard.ts):
// what is pinned or urgent right now, each with Unpin; below it, the newest
// other announcements, each with Pin and an optional end date. Pinned ones
// stay in the right column's Announcements card until unpinned or their end
// date passes; urgent ones are marked by their author on the form and show
// here so an admin sees everything on the card in one place.
//
// Posts News Sync copies in are News items of their own since 2026-11-18, not
// announcements, so they are not listed here; an admin pins one from its page,
// as any item.

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  dayFromToday,
  endOfDay,
  Group,
  localShortDate,
  refreshAside,
  shortDay,
  StatusChip,
  useApi,
  useSpace,
  useViewer,
} from "@civic-social/plugin-sdk/ui";
import {
  adminListAnnouncements,
  adminPinAnnouncement,
  adminUnpinAnnouncement,
  type AdminAnnouncementRow,
  type AdminAnnouncements as Board,
} from "./api";
import "./AdminAnnouncements.css";

function Byline({ row }: { row: AdminAnnouncementRow }) {
  const who = row.author_display_name || (row.author_role === "board" ? "Board member" : row.author_role);
  return (
    <span className="admin-ann-meta">
      {who} · {localShortDate(row.created_at)}
    </span>
  );
}

export default function AdminAnnouncements() {
  const { isAdmin, loading: authLoading } = useViewer();
  const space = useSpace();
  const tz = space.timeZone;
  const { data, loading, error, reload } = useApi<Board>(
    !authLoading && isAdmin ? "admin/announcements" : null,
    () => adminListAnnouncements(),
  );
  // The row being pinned: its end date is asked for in place.
  const [pinning, setPinning] = useState<string | null>(null);
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
      setPinning(null);
      setUntil("");
      refreshAside();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const full = data ? data.pinned_count >= data.pinned_max : false;
  const pinnedRows = data?.pinned ?? [];
  const recentRows = data?.recent ?? [];

  return (
    <div className="page admin-page admin-announcements-page">
      <h1 className="kit-page-title">Announcements</h1>
      <p className="admin-page-description kit-page-lede">
        Pinned announcements stay in the Announcements card in the right column until you unpin them or their end
        date passes. Urgent ones carry a red label and a line across the top of the hub's pages; whoever posts an
        announcement can mark it urgent on its form. Pinning doesn't move anything in the feed, and neither is sent
        to the Fediverse. When nothing is pinned or urgent, the card shows the latest announcements.
      </p>
      <p>
        <Link to="/announcement/new">Post an announcement</Link>
      </p>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {loading && !data && <p className="kit-note">Loading…</p>}
      {error && <p className="form-error">{error.message}</p>}

      {data && (
        <>
          <Group
            heading="Pinned and urgent"
            description={`${data.pinned_count} of ${data.pinned_max} pinned. The card shows three and scrolls for the rest; urgent ones come first.`}
          >
            {pinnedRows.length === 0 ? (
              <p className="kit-note">Nothing is pinned or urgent. The card shows the latest announcements.</p>
            ) : (
              <ul className="admin-ann-list">
                {pinnedRows.map((row) => (
                  <li key={row.id} className="admin-ann-row">
                    <div className="admin-ann-text">
                      <Link to={`/announcement/${row.id}`} className="admin-ann-title">
                        {row.title}
                      </Link>
                      <span className="admin-ann-marks">
                        {row.urgent && <StatusChip tone="alert">Urgent</StatusChip>}
                        {row.urgent && row.urgent_until && <span>until {shortDay(row.urgent_until, tz)}</span>}
                        {row.pinned && (
                          <span>
                            Pinned{row.pinned_until ? ` until ${shortDay(row.pinned_until, tz)}` : ", no end date"}
                          </span>
                        )}
                      </span>
                      <Byline row={row} />
                    </div>
                    <div className="admin-ann-actions">
                      {row.pinned ? (
                        <Button size="sm" disabled={busy === row.id} onClick={() => act(row.id, () => adminUnpinAnnouncement(row.id))}>
                          Unpin
                        </Button>
                      ) : (
                        <Button size="sm" disabled={busy === row.id || full} onClick={() => act(row.id, () => adminPinAnnouncement(row.id, null))}>
                          Pin
                        </Button>
                      )}
                      {row.urgent && (
                        <Link to={`/announcement/${row.id}/edit`} className="admin-ann-edit">
                          Change urgent
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <Group heading="Other announcements" description="Newest first. Pin one to keep it in the card.">
            {recentRows.length === 0 ? (
              <p className="kit-note">No other announcements.</p>
            ) : (
              <ul className="admin-ann-list">
                {recentRows.map((row) => (
                  <li key={row.id} className="admin-ann-row">
                    <div className="admin-ann-text">
                      <Link to={`/announcement/${row.id}`} className="admin-ann-title">
                        {row.title}
                      </Link>
                      <Byline row={row} />
                    </div>
                    <div className="admin-ann-actions">
                      {pinning === row.id ? (
                        <form
                          className="admin-ann-pin-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(row.id, () => adminPinAnnouncement(row.id, endOfDay(until, tz)));
                          }}
                        >
                          <label className="admin-ann-until">
                            <span>
                              Until <span className="optional">(optional)</span>
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
                            Pin
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPinning(null)}>
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <Button
                          size="sm"
                          disabled={full}
                          title={full ? `${data.pinned_max} are pinned already. Unpin one first.` : undefined}
                          onClick={() => {
                            setPinning(row.id);
                            setUntil("");
                            setActionError(null);
                          }}
                        >
                          Pin
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </>
      )}
    </div>
  );
}
