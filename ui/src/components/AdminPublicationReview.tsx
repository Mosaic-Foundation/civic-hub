/**
 * The admin's publication review: a queue of records a process produced when
 * it closed (briefs, the legacy vote results), each opened for review, edited
 * while pending, and approved to publish. AdminBriefs and AdminVoteResults
 * were copies of one page (audit F6); they now share this shell and keep only
 * what is theirs (a brief's headline, summary and recipients; a vote result's
 * positions and the vote it snapshotted).
 *
 * The markup and classes are the pages' own (AdminVoteResults.css), so both
 * look as they did.
 */

import { useMemo, useState, type ReactNode } from "react";
import { HeldBackNote } from "./HeldBackNote";
import type { HeldBackRecipient } from "../services/api";

export type PublicationStatus = "pending" | "approved" | "published";

const STATUS_FILTERS: Array<{ id: "all" | PublicationStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
];

export function StatusChip({ status }: { status: PublicationStatus }) {
  const label = status === "pending" ? "pending review" : status === "approved" ? "approved" : "published";
  return <span className={`status-badge admin-brief-status-${status}`}>{label}</span>;
}

/** The queue: its heading, the status filter, and one row per record. */
export function PublicationList<R extends { id: string; publication_status: PublicationStatus }>({
  heading,
  intro,
  records,
  loading,
  error,
  emptyAll,
  emptyNoun,
  onOpen,
  row,
}: {
  heading: string;
  intro: ReactNode;
  records: R[];
  loading: boolean;
  error: string | null;
  /** Shown when there are none at all. */
  emptyAll: string;
  /** "briefs": "No pending briefs." */
  emptyNoun: string;
  onOpen: (id: string) => void;
  /** A row's header, preview and meta, inside its <li>. */
  row: (record: R) => ReactNode;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | PublicationStatus>("all");
  const filtered = useMemo(
    () => (statusFilter === "all" ? records : records.filter((r) => r.publication_status === statusFilter)),
    [records, statusFilter],
  );

  return (
    <div className="page admin-briefs-page">
      <div className="admin-briefs-body">
        <h1>{heading}</h1>
        <p className="admin-subtitle">{intro}</p>

        <div className="admin-brief-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`admin-brief-filter${statusFilter === f.id ? " is-active" : ""}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p>Loading…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <p className="empty-state-inline">
            {statusFilter === "all" ? emptyAll : `No ${statusFilter} ${emptyNoun}.`}
          </p>
        )}

        <ul className="admin-proposal-list">
          {filtered.map((record) => (
            <li key={record.id} className="admin-proposal-item" onClick={() => onOpen(record.id)}>
              {row(record)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One record under review: the back link, its heading and status line, messages, the sections, and the actions. */
export function PublicationReview({
  title,
  subtitle,
  backLabel,
  onBack,
  actionMessage,
  error,
  heldBack,
  children,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  backLabel: string;
  onBack: () => void;
  actionMessage: string | null;
  error: string | null;
  heldBack: HeldBackRecipient[] | undefined;
  /** The record's own sections (and anything shown above them). */
  children: ReactNode;
  /** <ApproveActions> while pending, and any hint after it. */
  actions: ReactNode;
}) {
  return (
    <div className="page admin-briefs-page">
      <div className="admin-briefs-body">
        <button className="admin-back-link" onClick={onBack} type="button">
          &larr; {backLabel}
        </button>
        <h1>Review: {title}</h1>
        <p className="admin-subtitle">{subtitle}</p>

        {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
        {error && <p className="form-error">{error}</p>}

        {children}

        <HeldBackNote heldBack={heldBack} />

        {actions}
      </div>
    </div>
  );
}

/** Save, and Approve and publish behind a confirmation. */
export function ApproveActions({
  saveLabel,
  saving,
  approving,
  confirming,
  onSave,
  onApprove,
  onConfirm,
  onCancel,
}: {
  saveLabel: string;
  saving: boolean;
  approving: boolean;
  confirming: boolean;
  onSave: () => void;
  onApprove: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="admin-actions">
      <button type="button" className="admin-archive-button" onClick={onSave} disabled={saving || approving}>
        {saving ? "Saving…" : saveLabel}
      </button>
      {confirming ? (
        <>
          <button type="button" className="admin-convert-button" onClick={onApprove} disabled={approving}>
            {approving ? "Approving…" : "Confirm: approve and publish"}
          </button>
          <button type="button" className="admin-cancel-button" onClick={onCancel} disabled={approving}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="admin-convert-button" onClick={onConfirm} disabled={saving}>
          Approve and publish
        </button>
      )}
    </div>
  );
}
