import { useEffect, useState } from "react";
import { api, type Hub } from "./api";
import { href } from "./route";
import { ModeBadge, StatusBadge } from "./ui";
import { day } from "./format";

export default function HubList() {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    api.hubs().then((r) => setHubs(r.hubs)).catch((e: Error) => setError(e.message));
  }, []);

  const archived = hubs?.filter((h) => h.archived_at).length ?? 0;
  // Newest first (Adam, 2026-10-08): the hub just made is at the top.
  const shown = (hubs?.filter((h) => showArchived || !h.archived_at) ?? []).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  return (
    <section>
      <div className="cx-page-head">
        <div>
          <h1 className="cx-title">Hubs</h1>
          {hubs && (
            <p className="cx-muted">
              {hubs.length - archived} in service{archived > 0 ? `, ${archived} archived` : ""}
            </p>
          )}
        </div>
        <a className="cx-btn cx-btn-primary" href={href({ name: "new" })}>
          Create hub
        </a>
      </div>

      {error && <p className="cx-alert cx-alert-error">{error}</p>}
      {!hubs && !error && <p className="cx-muted">Loading…</p>}

      {hubs && (
        <>
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th scope="col">Hub</th>
                  <th scope="col">Hostname</th>
                  <th scope="col">Status</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="cx-hide-sm">Created</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.id} className={h.archived_at ? "cx-row-archived" : undefined}>
                    <td>
                      <a className="cx-strong" href={href({ name: "hub", id: h.id })}>
                        {h.name}
                      </a>
                      <div className="cx-mono cx-muted">{h.id}</div>
                    </td>
                    <td className="cx-mono cx-break">{h.hostname}</td>
                    <td>
                      <StatusBadge hub={h} />
                    </td>
                    <td>
                      <ModeBadge mode={h.mode} />
                    </td>
                    <td className="cx-hide-sm cx-muted">{day(h.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {archived > 0 && (
            <label className="cx-check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived hubs
            </label>
          )}
        </>
      )}
    </section>
  );
}
