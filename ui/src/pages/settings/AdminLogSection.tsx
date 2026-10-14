import { useEffect, useState } from "react";
import HelpButton from "../../components/HelpButton";
import { Link } from "react-router-dom";
import { adminGetHubAdminLog, type HubAdminLogEntry } from "../../services/api";

/**
 * Settings → Admin log (admin menu slice, 2026-10-13): what this hub's admins
 * did that the hub keeps a record of: removing samples, changing the mode or
 * the admins and board, closing a process early, making a brief again.
 * Newest first, the last 100. A list rather than a table, so it reads on a
 * phone. The console shows the same rows to the operator.
 */
export default function AdminLogSection() {
  const [entries, setEntries] = useState<HubAdminLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGetHubAdminLog()
      .then((r) => setEntries(r.entries))
      .catch(() => setError("The admin log could not be loaded. Try again in a moment."));
  }, []);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">
        Admin log
        <HelpButton k="settings.admin-log" label="Admin log" />
      </h2>
      <p className="settings-section-intro">
        What admins of this hub have done that the hub keeps a record of, newest first. Hiding a comment or removing an
        announcement is in the <Link to="/admin/moderation">Moderation</Link> log instead.
      </p>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !entries ? (
        <p className="form-hint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="form-hint">Nothing recorded yet.</p>
      ) : (
        <ul className="admin-log-list">
          {entries.map((e) => (
            <li key={e.id} className="admin-log-entry">
              <span className="admin-log-what">{describe(e)}</span>
              <span className="admin-log-meta">
                {e.actor_email} · {formatTime(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function field(v: unknown, key: string): string | null {
  const x = (v as Record<string, unknown> | null)?.[key];
  return typeof x === "string" && x ? x : null;
}

function describe(e: HubAdminLogEntry): string {
  switch (e.action) {
    case "sample_content.remove":
      return "Removed the sample content";
    case "sample_content.delete_one": {
      const title = field(e.before, "title");
      return title ? `Deleted a sample: “${title}”` : "Deleted a sample";
    }
    case "hub.mode": {
      const from = field(e.before, "mode");
      const to = field(e.after, "mode");
      return from && to ? `Changed the mode from ${from} to ${to}` : "Changed the mode";
    }
    case "people.admins":
      return "Changed the admins";
    case "people.board":
      return "Changed the board";
    case "process.close_early": {
      const title = field(e.after, "title");
      return title ? `Closed “${title}” early` : "Closed a process early";
    }
    case "brief.regenerate":
      return "Made a brief again";
    case "brief.revision_published":
      return "Published a brief's new version";
    case "feedback.forward":
      return field(e.after, "stream") === "feature"
        ? "Sent a feedback item to Civic.Social as an idea"
        : "Sent a feedback item to Civic.Social as a bug";
    case "member.invite":
      return describeInvite(e.after);
    default:
      return e.action;
  }
}

/** "Invited 2 people by email (a@x.org, b@y.org)" — the addresses only, never the message. */
function describeInvite(after: unknown): string {
  const list = (key: string): string[] => {
    const v = after && typeof after === "object" ? (after as Record<string, unknown>)[key] : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };
  const invited = list("invited");
  const skipped = list("already_invited_or_member");
  const over = list("over_limit");
  const how = field(after, "outcome") === "waitlisted" ? "to the waitlist" : "by email";
  const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
  const parts = [`Invited ${people(invited.length)} ${how}${invited.length ? ` (${invited.join(", ")})` : ""}`];
  if (skipped.length) parts.push(`skipped ${skipped.length} already invited or here (${skipped.join(", ")})`);
  if (over.length) parts.push(`${over.length} over the daily limit`);
  return parts.join("; ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
