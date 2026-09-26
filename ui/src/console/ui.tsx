// Small shared pieces: status and mode badges, dates.
import type { Hub } from "./api";

export function StatusBadge({ hub }: { hub: Pick<Hub, "status" | "archived_at"> }) {
  if (hub.archived_at) return <span className="cx-badge cx-badge-archived">archived</span>;
  return <span className={`cx-badge cx-badge-${hub.status}`}>{hub.status}</span>;
}

export function ModeBadge({ mode }: { mode: string | null }) {
  return <span className={`cx-badge cx-mode-${mode ?? "unset"}`}>{mode ?? "unset"}</span>;
}
