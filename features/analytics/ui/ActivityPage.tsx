// Admin → Activity (ADR-016): how much participation this hub has, of what
// kind, over a calendar period, counted from the hub's record in numbers that
// never name anyone. The period's totals, each type's, the funder report with
// how each measure is counted, repeat participation, the CSV, Public numbers
// and the reporting keys with their read log.

import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../../ui/src/hooks/useApi";
import { useAuth } from "../../../ui/src/context/authState";
import { useHub } from "../../../ui/src/config/hub";
import HelpButton from "../../../ui/src/components/HelpButton";
import { localTimestamp } from "../../../ui/src/utils/dates";
import { typeColorSlug } from "../../../ui/src/processes/display";
import { adminPutHubSettings } from "../../../ui/src/services/api";
import { refreshHubConfig } from "../../../ui/src/config/hubConfig";
import { addDays, type PeriodKind } from "../periods";
import type { Count, Report } from "../types";
import { downloadCsv, getActivity, issueKey, listKeys, recount, revokeKey, type ReportKey } from "./api";
import "./activity.css";

const KINDS: Array<{ id: PeriodKind; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "all", label: "Since launch" },
];

// Colour does work here (Adam, 2026-10-29: "it looks very boring"): the
// headline number on the primary fill, the others each with a bar in one of
// the kinds' colours; the funders' measures in the colour of what they count.
const TOTALS: Array<{ key: keyof Report["totals"]; label: string; accent?: string }> = [
  { key: "active_residents", label: "Active residents" },
  { key: "new_residents", label: "New residents", accent: "meeting" },
  { key: "participations", label: "Participations", accent: "vote" },
  { key: "processes_created", label: "Processes created", accent: "proposal" },
  { key: "processes_closed", label: "Processes closed", accent: "conversation" },
  { key: "outcomes", label: "Results and briefs", accent: "brief" },
];

const MEASURE_ACCENTS = ["meeting", "project", "brief"];

/** A card's top bar in a colour family's dark tone (theme.css, --type-<slug>-fg). */
function accent(slug: string): CSSProperties {
  return { "--card-accent": `var(--type-${slug}-fg)` } as CSSProperties;
}

const show = (v: Count) => (typeof v === "number" ? v.toLocaleString() : v);

/** A day in the period before or after the one shown. */
function stepped(r: Report, by: -1 | 1): string {
  return by < 0 ? addDays(r.period.start, -1) : addDays(r.period.end, 1);
}

export default function ActivityPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const hub = useHub();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [at, setAt] = useState<string | null>(null);
  const report = useApi(!authLoading && isAdmin ? `admin/analytics/${kind}/${at ?? "now"}` : null, () => getActivity(kind, at));
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (authLoading) return <div className="page admin-page"><p>Loading…</p></div>;
  if (!isAdmin) return <div className="page admin-page"><p>Admin access required.</p></div>;

  const r = report.data;
  const publicOn = hub.setting("plugin.analytics.public_numbers") === "true";

  async function act(what: string, fn: () => Promise<unknown>) {
    setBusy(what);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : `${what} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page admin-page activity-page" data-testid="activity-page">
      <h1 className="kit-page-title">
        Activity <HelpButton k="plugins.analytics" label="Activity" />
      </h1>
      <p className="kit-page-lede">
        How many residents took part, and in what, counted from this hub's record. Every number is a count; none of
        them names anyone. Residents who take part in person and are not recorded here are not counted.
      </p>

      <div className="activity-toolbar" role="group" aria-label="Period">
        <span className="kit-chips">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`kit-chip activity-chip${kind === k.id ? " is-on" : ""}`}
              aria-pressed={kind === k.id}
              onClick={() => {
                setKind(k.id);
                setAt(null);
              }}
            >
              {k.label}
            </button>
          ))}
        </span>
        {r && kind !== "all" && (
          <span className="kit-chips activity-step">
            <button type="button" className="kit-chip activity-chip" aria-label="Previous period" onClick={() => setAt(stepped(r, -1))}>
              ←
            </button>
            <button
              type="button"
              className="kit-chip activity-chip"
              aria-label="Next period"
              disabled={r.period.to_date}
              onClick={() => setAt(stepped(r, 1))}
            >
              →
            </button>
          </span>
        )}
      </div>

      {report.error && <p className="form-error" role="alert">The numbers could not be loaded: {report.error.message}</p>}
      {problem && <p className="form-error" role="alert">{problem}</p>}
      {!r ? (
        !report.error && <p>Loading…</p>
      ) : (
        <>
          <p className="activity-period" data-testid="activity-period">
            <strong>{r.period.label}</strong>
            {r.period.to_date ? `, so far (to ${r.period.end})` : ` (${r.period.start} to ${r.period.end})`}.{" "}
            {r.live
              ? "Counted just now from the hub's record; stored by the hourly count."
              : r.computed_at
                ? `Counted ${localTimestamp(r.computed_at)}; recounted every hour.`
                : "Not counted yet."}{" "}
            <button type="button" className="btn-secondary btn-sm activity-inline-btn" disabled={busy !== null} onClick={() => act("Recount", async () => { await recount(); await report.reload(); })}>
              {busy === "Recount" ? "Counting…" : "Recount now"}
            </button>
          </p>

          <ul className="kit-stats activity-tiles">
            {TOTALS.map((t) => (
              <li
                key={t.key}
                className={`kit-card kit-stat activity-tile ${t.accent ? "kit-card--accent" : "kit-stat--featured"}`}
                style={t.accent ? accent(t.accent) : undefined}
                title={r.definitions[t.key]}
                data-testid={`activity-total-${t.key}`}
              >
                <span className="kit-stat-n activity-n">{show(r.totals[t.key])}</span>
                <span className="kit-stat-label activity-label">{t.label}</span>
              </li>
            ))}
          </ul>

          <h2 className="kit-section-title">By kind</h2>
          <div className="kit-table-wrap activity-table-wrap">
            <table className="kit-table activity-table" data-testid="activity-by-type">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col" className="is-number">Active residents</th>
                  <th scope="col" className="is-number">Participations</th>
                  <th scope="col" className="is-number">Created</th>
                  <th scope="col" className="is-number">Closed</th>
                  <th scope="col" className="is-number">Results and briefs</th>
                </tr>
              </thead>
              <tbody>
                {r.by_type.map((t) => (
                  <tr key={t.type}>
                    <th scope="row">
                      <span className="kit-dot" style={{ "--dot": `var(--type-${typeColorSlug(t.type)}-fg)` } as CSSProperties} />
                      {t.plural}
                    </th>
                    <td className="is-number">{show(t.active_residents)}</td>
                    <td className="is-number">{show(t.participations)}</td>
                    <td className="is-number">{show(t.processes_created)}</td>
                    <td className="is-number">{show(t.processes_closed)}</td>
                    <td className="is-number">{show(t.outcomes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="kit-section-title">For funders</h2>
          <p className="admin-page-description">
            Three things civic surveys ask people to remember, counted instead from what this hub recorded. They say what
            happened, not how anyone felt about it, and they count only people who took part here.
          </p>
          <ul className="activity-measures" data-testid="activity-measures">
            {r.measures.map((m, i) => (
              <li
                key={m.id}
                className="kit-card kit-card--accent activity-measure"
                style={accent(MEASURE_ACCENTS[i % MEASURE_ACCENTS.length]!)}
                data-testid={`activity-measure-${m.id}`}
              >
                <h3>{m.label}</h3>
                <p className="activity-measure-figures">
                  <span><span className="kit-stat-n activity-n">{show(m.residents.value)}</span> {m.residents.label}</span>
                  <span><span className="kit-stat-n activity-n">{show(m.records.value)}</span> {m.records.label}</span>
                </p>
                <details>
                  <summary>How this is counted</summary>
                  <p>{m.derivation}</p>
                </details>
              </li>
            ))}
          </ul>

          <h2 className="kit-section-title">Coming back</h2>
          <ul className="kit-stats activity-tiles activity-tiles-two">
            <li className="kit-card kit-card--accent kit-stat activity-tile" style={accent("project")} title={r.definitions.residents_in_more_than_one_type}>
              <span className="kit-stat-n activity-n">{show(r.retention.residents_in_more_than_one_type)}</span>
              <span className="kit-stat-label activity-label">took part in more than one kind</span>
            </li>
            <li className="kit-card kit-card--accent kit-stat activity-tile" style={accent("wordcloud")} title={r.definitions.returning_from_previous_period}>
              <span className="kit-stat-n activity-n">{r.previous_period ? show(r.retention.returning_from_previous_period) : "—"}</span>
              <span className="kit-stat-label activity-label">
                {r.previous_period ? "also took part in the period before" : "no period before this one"}
              </span>
            </li>
          </ul>

          <p>
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => act("Download", () => downloadCsv(kind, at))} data-testid="activity-csv">
              {busy === "Download" ? "Preparing…" : "Download CSV"}
            </button>
          </p>
        </>
      )}

      <h2 className="kit-section-title" id="public-numbers">
        Public numbers <HelpButton k="plugin.analytics.public_numbers" label="Public numbers" />
      </h2>
      <p data-testid="activity-public-status">
        {publicOn ? (
          <>
            On. Anyone can read these numbers at <a href="/api/analytics" target="_blank" rel="noreferrer">/analytics</a>, and
            the About page shows them, with numbers from 1 to 4 shown as "fewer than 5".
          </>
        ) : (
          <>Off. Only the organisations below can read these numbers, with numbers from 1 to 4 shown as "fewer than 5".</>
        )}
      </p>
      {/* The switch itself, here as well as under Plugins (engine 2, D12). */}
      <p>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          data-testid="activity-public-toggle"
          onClick={() =>
            act("Public numbers", async () => {
              await adminPutHubSettings("plugins", { "plugin.analytics.public_numbers": !publicOn });
              await refreshHubConfig();
            })
          }
        >
          {busy === "Public numbers" ? "Saving…" : publicOn ? "Make the numbers private" : "Make the numbers public"}
        </button>{" "}
        <span className="activity-muted">
          Also under <Link to="/admin/settings/plugins#analytics">Plugins</Link>.
        </span>
      </p>

      <ReportingKeys />
    </div>
  );
}

function ReportingKeys() {
  const keys = useApi("admin/analytics/keys", () => listKeys());
  const [form, setForm] = useState({ organisation: "", contact: "", purpose: "" });
  const [issued, setIssued] = useState<(ReportKey & { key: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function onIssue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setIssued(await issueKey(form));
      setForm({ organisation: "", contact: "", purpose: "" });
      await keys.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be issued");
    }
  }

  async function onRevoke(id: string) {
    setError(null);
    try {
      await revokeKey(id);
      setConfirm(null);
      await keys.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be revoked");
    }
  }

  const live = keys.data?.keys ?? [];
  return (
    <section className="activity-keys" aria-labelledby="reporting-keys">
      <h2 className="kit-section-title" id="reporting-keys">Reporting keys</h2>
      <p className="admin-page-description">
        A key lets a named outside organisation, such as a funder or a researcher, read these numbers even while Public
        numbers is off. Every read is recorded below. Revoke a key and it reads nothing.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {issued && (
        <div className="activity-issued" role="status" data-testid="activity-issued-key">
          <p>
            <strong>The key for {issued.organisation}.</strong> Copy it now and send it to them: it is not shown again.
            They send it as <code>Authorization: Bearer …</code> when they read <code>/analytics</code>.
          </p>
          <code className="activity-key">{issued.key}</code>
          <button type="button" className="btn-secondary btn-sm activity-inline-btn" onClick={() => void navigator.clipboard?.writeText(issued.key)}>
            Copy
          </button>{" "}
          <button type="button" className="btn-secondary btn-sm activity-inline-btn" onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      <form className="activity-key-form" onSubmit={onIssue}>
        <label>
          Organisation
          <input required maxLength={200} value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
        </label>
        <label>
          Contact
          <input required maxLength={200} placeholder="A name or an address" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        </label>
        <label>
          What it is for
          <input required maxLength={1000} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </label>
        <button type="submit" className="btn-primary">Issue a key</button>
      </form>

      {live.length > 0 && (
        <div className="kit-table-wrap activity-table-wrap">
          <table className="kit-table activity-table" data-testid="activity-keys">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Contact</th>
                <th scope="col">For</th>
                <th scope="col">Key</th>
                <th scope="col">Issued</th>
                <th scope="col"><span className="visually-hidden">Revoke</span></th>
              </tr>
            </thead>
            <tbody>
              {live.map((k) => (
                <tr key={k.id} className={k.revoked_at ? "is-revoked" : undefined}>
                  <th scope="row">{k.organisation}</th>
                  <td>{k.contact}</td>
                  <td>{k.purpose}</td>
                  <td><code>…{k.key_hint}</code></td>
                  <td>{localTimestamp(k.created_at)}</td>
                  <td>
                    {k.revoked_at ? (
                      `Revoked ${localTimestamp(k.revoked_at)}`
                    ) : confirm === k.id ? (
                      <>
                        <button type="button" className="admin-cancel-button" onClick={() => void onRevoke(k.id)}>Revoke it</button>{" "}
                        <button type="button" className="btn-secondary btn-sm activity-inline-btn" onClick={() => setConfirm(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary btn-sm activity-inline-btn" onClick={() => setConfirm(k.id)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Reads with a key</h3>
      {(keys.data?.reads ?? []).length === 0 ? (
        <p className="admin-page-description">No organisation has read the numbers with a key yet.</p>
      ) : (
        <div className="kit-table-wrap activity-table-wrap">
          <table className="kit-table activity-table" data-testid="activity-reads">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Organisation</th>
                <th scope="col">Period</th>
              </tr>
            </thead>
            <tbody>
              {keys.data!.reads.map((r, i) => (
                <tr key={`${r.key_id}-${r.read_at}-${i}`}>
                  <td>{localTimestamp(r.read_at)}</td>
                  <th scope="row">{r.organisation}</th>
                  <td>{r.period_kind} from {r.period_start}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
