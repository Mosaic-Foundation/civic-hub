// Civic.Social's feedback inbox (feedback routing, 2026-10-13): every hub's
// software reports and hub admins' messages, likely duplicates together.
// Civic.Social sets a status, which shows on the hub's badge, and pastes the
// GitHub issue it wrote by hand. Nothing here talks to GitHub; a sender's
// address shows only when they consented.

import { useCallback, useEffect, useState } from "react";
import { api, type FeedbackItem, type FeedbackStatus, type FeedbackStream } from "./api";
import { href } from "./route";
import { when } from "./format";

const STREAMS: ReadonlyArray<{ value: FeedbackStream | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "bug", label: "Bugs" },
  { value: "feature", label: "Feature requests" },
  { value: "admin", label: "From admins" },
];

const STATUSES: ReadonlyArray<{ value: FeedbackStatus; label: string }> = [
  { value: "received", label: "Received" },
  { value: "planned", label: "Planned" },
  { value: "fixed", label: "Fixed" },
];

const STREAM_LABEL: Record<FeedbackStream, string> = { bug: "Bug", feature: "Feature request", admin: "From an admin" };
const ORIGIN_LABEL: Record<FeedbackItem["origin"], string> = {
  resident: "sent by the person who wrote it",
  forwarded: "forwarded by a hub admin",
  admin: "written by a hub admin",
};

export default function FeedbackInbox({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [stream, setStream] = useState<FeedbackStream | "">("");
  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const [groups, setGroups] = useState<FeedbackItem[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .feedback({ ...(stream ? { stream } : {}), ...(status ? { status } : {}) })
      .then((r) => {
        setGroups(r.groups);
        setError(null);
        onCountChange?.(r.received);
      })
      .catch((e: Error) => setError(e.message));
  }, [stream, status, onCountChange]);

  useEffect(load, [load]);

  function replace(next: FeedbackItem) {
    setGroups((gs) => gs && gs.map((g) => g.map((i) => (i.id === next.id ? { ...next, hub_name: i.hub_name } : i))));
  }

  const items = groups?.reduce((n, g) => n + g.length, 0) ?? 0;

  return (
    <section>
      <h1 className="cx-title">Feedback</h1>
      <p className="cx-muted">
        Software reports from every hub and messages from hub admins, newest first, likely duplicates together (same
        page, similar words). Your status shows on the hub's badge. Write GitHub issues by hand and paste the link
        here; nothing is sent to GitHub. An address shows only when the sender agreed.
      </p>

      <div className="cx-fb-filters">
        <div className="cx-fb-filter" role="group" aria-label="Stream">
          {STREAMS.map((s) => (
            <button
              key={s.value || "all"}
              type="button"
              className={`cx-btn${stream === s.value ? " cx-btn-primary" : ""}`}
              aria-pressed={stream === s.value}
              onClick={() => setStream(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="cx-fb-status-filter">
          <span className="cx-muted cx-small">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | "")}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="cx-alert cx-alert-error">{error}</p>}
      {!groups && !error && <p className="cx-muted">Loading…</p>}
      {groups && groups.length === 0 && <p className="cx-muted">Nothing here.</p>}
      {groups && groups.length > 0 && (
        <p className="cx-muted cx-small">
          {items} {items === 1 ? "item" : "items"} in {groups.length} {groups.length === 1 ? "group" : "groups"}
        </p>
      )}
      <ul className="cx-fb-list">
        {groups?.map((g) => (
          <li key={g[0].id} className={`cx-card cx-fb-group${g.length > 1 ? " is-dupes" : ""}`} data-testid="feedback-group">
            {g.length > 1 && (
              <p className="cx-fb-dupes">
                {g.length} likely duplicates on <code>{g[0].page_path}</code>
              </p>
            )}
            {g.map((item) => (
              <FeedbackCard key={item.id} item={item} onChanged={(next) => { replace(next); load(); }} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeedbackCard({ item, onChanged }: { item: FeedbackItem; onChanged: (next: FeedbackItem) => void }) {
  const [issue, setIssue] = useState(item.github_issue_url ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(patch: { status?: FeedbackStatus; github_issue_url?: string | null }) {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.updateFeedback(item.id, patch);
      onChanged(r.item);
      if (r.sender_told) {
        setNote(
          r.sender_told.sent
            ? { ok: true, text: "The sender was emailed that it's fixed." }
            : { ok: false, text: `The sender wasn't emailed: ${r.sender_told.reason ?? "unknown reason"}.` },
        );
      } else if (patch.github_issue_url !== undefined) {
        setNote({ ok: true, text: "Issue link saved." });
      }
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const issueChanged = (issue.trim() || null) !== (item.github_issue_url ?? null);

  return (
    <article className="cx-fb-item" data-testid="feedback-item" data-id={item.id}>
      <div className="cx-meta">
        <span className={`cx-badge cx-fb-stream-${item.stream}`}>{STREAM_LABEL[item.stream]}</span>
        <a className="cx-strong" href={href({ name: "hub", id: item.source_hub_id })}>
          {item.hub_name}
        </a>
        <span className="cx-muted cx-small">{when(item.created_at)}</span>
      </div>
      <p className="cx-fb-message">{item.message}</p>
      <dl className="cx-fb-facts">
        {item.page_path && (
          <>
            <dt>Page</dt>
            <dd className="cx-mono cx-break">{item.page_path}</dd>
          </>
        )}
        <dt>Came</dt>
        <dd>{ORIGIN_LABEL[item.origin]}</dd>
        <dt>Contact</dt>
        <dd className="cx-break" data-testid="feedback-contact">
          {item.contact_ok && item.contact_email ? (
            <a href={`mailto:${item.contact_email}`}>{item.contact_email}</a>
          ) : (
            <span className="cx-muted">No consent to contact</span>
          )}
        </dd>
        {item.software_version && (
          <>
            <dt>Version</dt>
            <dd className="cx-mono">{item.software_version.slice(0, 7)}</dd>
          </>
        )}
        {item.user_agent && (
          <>
            <dt>Browser</dt>
            <dd className="cx-small cx-muted cx-break">{item.user_agent}</dd>
          </>
        )}
        {item.screenshot_url && (
          <>
            <dt>Screenshot</dt>
            <dd>
              <a href={item.screenshot_url} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            </dd>
          </>
        )}
      </dl>

      <div className="cx-fb-controls">
        <label className="cx-fb-control">
          <span className="cx-small cx-muted">Status</span>
          <select
            value={item.status}
            disabled={busy}
            onChange={(e) => void save({ status: e.target.value as FeedbackStatus })}
            aria-label={`Status of this ${STREAM_LABEL[item.stream].toLowerCase()}`}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <form
          className="cx-fb-control cx-fb-issue"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ github_issue_url: issue.trim() || null });
          }}
        >
          <label className="cx-fb-control">
            <span className="cx-small cx-muted">GitHub issue</span>
            <input
              type="url"
              value={issue}
              placeholder="https://github.com/…/issues/…"
              onChange={(e) => setIssue(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" className="cx-btn" disabled={busy || !issueChanged}>
            Save link
          </button>
          {item.github_issue_url && !issueChanged && (
            <a href={item.github_issue_url} target="_blank" rel="noopener noreferrer" className="cx-small">
              Open issue
            </a>
          )}
        </form>
      </div>
      {note && <p className={`cx-alert ${note.ok ? "cx-alert-ok" : "cx-alert-warn"}`} role="status">{note.text}</p>}
    </article>
  );
}
