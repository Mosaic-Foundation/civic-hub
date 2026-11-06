import { useApi } from "../../hooks/useApi";
import HelpButton from "../../components/HelpButton";
import { Link } from "react-router-dom";
import { adminGetHubAdminLog, type HubAdminLogEntry } from "../../services/api";
import { localTimestamp } from "../../utils/dates";
import { SETTINGS_NAV } from "../../../../src/shared/adminAnchors";
import { SETTING_LABELS } from "../../../../src/shared/settingOwners";

/**
 * Settings → Admin log (admin menu slice, 2026-10-13): what this hub's admins
 * did that the hub keeps a record of: saving settings (the fields, never the
 * values), removing samples, changing the mode (with what was accepted for the
 * switch) or the admins and board, marking the Terms and Privacy reviewed,
 * closing a process early, making a brief again.
 * Newest first, the last 100. A list rather than a table, so it reads on a
 * phone. The console shows the same rows to the operator.
 */
export default function AdminLogSection() {
  const { data, error: loadError } = useApi("admin/hub-admin-log", () => adminGetHubAdminLog());
  const entries: HubAdminLogEntry[] | null = data?.entries ?? null;
  const error = loadError ? "The admin log could not be loaded. Try again in a moment." : null;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">
        Admin log
        <HelpButton k="settings.admin-log" label="Admin log" />
      </h2>
      <p className="settings-section-intro">
        A record of what this hub's admins have done, newest first, the last 100 entries. When several people run a hub,
        it's how you see who changed what, and when.
      </p>
      <p className="settings-section-intro">
        It lists settings saved (which fields, not what they said), admins and the board changed, the mode changed,
        samples removed, the Terms marked reviewed, processes closed early, briefs made again or republished, feedback
        sent on, member invites, and plugins installed, updated or removed. Hiding a comment or removing an announcement
        is in the <Link to="/admin/moderation">Moderation</Link> log instead.
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
                {e.actor_email} · {localTimestamp(e.at)}
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
    case "sample_content.auto_refresh": {
      const on = (e.after as { on?: unknown } | null)?.on;
      return on === false ? "Turned off keeping samples fresh automatically" : "Turned on keeping samples fresh automatically";
    }
    case "sample_content.refresh": {
      const after = e.after as { replaced?: unknown[]; added?: unknown[] } | null;
      const replaced = Array.isArray(after?.replaced) ? after.replaced.length : 0;
      const added = Array.isArray(after?.added) ? after.added.length : 0;
      const parts = [replaced ? `${replaced} replaced` : "", added ? `${added} added` : ""].filter(Boolean);
      return parts.length ? `Refreshed the samples: ${parts.join(", ")}` : "Refreshed the samples (nothing changed)";
    }
    case "sample_content.delete_one": {
      const title = field(e.before, "title");
      return title ? `Deleted a sample: “${title}”` : "Deleted a sample";
    }
    case "hub.mode": {
      const from = field(e.before, "mode");
      const to = field(e.after, "mode");
      const changed = from && to ? `Changed the mode from ${from} to ${to}` : "Changed the mode";
      const accepted = acceptedItems(e.after);
      return accepted.length ? `${changed}, accepting: ${accepted.join("; ")}` : changed;
    }
    case "legal.reviewed":
      return (e.after as { reviewed?: unknown } | null)?.reviewed === true
        ? "Marked the Terms and Privacy Policy as reviewed"
        : "Marked the Terms and Privacy Policy as not reviewed";
    case "settings.save":
      return describeSave(e.after);
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
    case "plugin.install":
      return `Installed ${field(e.after, "plugin") ?? "a plugin"}`;
    case "plugin.remove":
      return field(e.after, "reason")
        ? `${field(e.after, "plugin") ?? "A plugin"} switched off by itself: ${field(e.after, "reason")}`
        : `Removed ${field(e.after, "plugin") ?? "a plugin"} (stopped now)`;
    case "plugin.wind_down":
      return `Started winding down ${field(e.after, "plugin") ?? "a plugin"}`;
    case "plugin.update":
      return `Updated ${field(e.after, "plugin") ?? "a plugin"} to version ${field(e.after, "version") ?? "?"}`;
    default:
      return e.action;
  }
}

/** "Saved Legal: Operated by, Contact address". Names only: the log never holds the values. */
function describeSave(after: unknown): string {
  const section = SETTINGS_NAV.find((s) => s.id === field(after, "section"))?.label ?? field(after, "section") ?? "settings";
  const v = (after as Record<string, unknown> | null)?.fields;
  const fields = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(fieldName) : [];
  return fields.length ? `Saved ${section}: ${fields.join(", ")}` : `Saved ${section}`;
}

/** A setting's label, or its key in words where it has none. */
function fieldName(key: string): string {
  const words = (SETTING_LABELS[key] ?? key.split(".").slice(1).join(" ").replace(/_/g, " ")).replace(/^"|"$/g, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What the admin accepted as it was for a mode switch (the readiness items'
 * ids, src/services/modeReadiness.ts), in the words of the box they ticked.
 */
const ACCEPTED: Record<string, string> = {
  name_and_place: "the name and place as they are",
  contact_email: "the platform's contact address for now",
  second_admin: "just one admin for now",
  legal_reviewed: "the Terms and Privacy Policy not yet reviewed",
  samples: "the sample content kept for now",
};

function acceptedItems(after: unknown): string[] {
  const v = (after as Record<string, unknown> | null)?.accepted;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((id) => ACCEPTED[id] ?? id);
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

