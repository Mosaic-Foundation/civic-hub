import { useEffect, useState } from "react";
import { api, type AuditEntry } from "./api";
import { href } from "./route";
import { when } from "./format";

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.audit().then((r) => setEntries(r.entries)).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <section>
      <h1 className="cx-title">Audit log</h1>
      <p className="cx-muted">Every console action, newest first. Append-only: nothing here can be edited or removed.</p>
      {error && <p className="cx-alert cx-alert-error">{error}</p>}
      {!entries && !error && <p className="cx-muted">Loading…</p>}
      {entries && (
        <div className="cx-card">
          <AuditTable entries={entries} showHub />
        </div>
      )}
    </section>
  );
}

function summary(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 1).replace(/\n\s*/g, " ");
}

export function AuditTable({ entries, showHub }: { entries: AuditEntry[]; showHub: boolean }) {
  if (entries.length === 0) return <p className="cx-muted">Nothing yet.</p>;
  return (
    <div className="cx-table-wrap">
      <table className="cx-table cx-audit">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            {showHub && <th scope="col">Hub</th>}
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col" className="cx-hide-sm">Who</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="cx-nowrap cx-muted">{when(e.at)}</td>
              <td className="cx-mono">{e.action}</td>
              {showHub && (
                <td className="cx-mono">
                  {e.target_hub_id ? <a href={href({ name: "hub", id: e.target_hub_id })}>{e.target_hub_id}</a> : "—"}
                </td>
              )}
              <td>
                <code className="cx-json" title={summary(e.before)}>{summary(e.before)}</code>
              </td>
              <td>
                <code className="cx-json" title={summary(e.after)}>{summary(e.after)}</code>
              </td>
              <td className="cx-hide-sm cx-muted cx-break">{e.actor_email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
