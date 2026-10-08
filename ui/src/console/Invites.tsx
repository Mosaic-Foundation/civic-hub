// Invite codes (session 4b, Adam 2026-10-08). A code lets one person create
// one demo hub on the start page and become its admin. The code is shown
// once, here, right after it is minted: the server keeps only its hash, and
// the list shows its last four characters.

import { useEffect, useState } from "react";
import { api, type Invite, type InviteList } from "./api";
import { href } from "./route";
import { day, when } from "./format";

const STATUS_LABEL: Record<Invite["status"], string> = {
  unused: "unused",
  used: "used",
  expired: "expired",
  revoked: "revoked",
};

function StatusBadge({ status }: { status: Invite["status"] }) {
  const cls = status === "unused" ? "cx-badge-active" : status === "used" ? "cx-mode-beta" : "cx-badge-archived";
  return <span className={`cx-badge ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function Minted({ code, startHost, onDone }: { code: string; startHost: string | null; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = startHost ? `https://${startHost}` : null;
  const message = link
    ? `Here's your invite to create a Civic Hub. Go to ${link} and enter this code: ${code}`
    : code;
  return (
    <div className="cx-card cx-invite-card cx-minted" role="status">
      <p className="cx-eyebrow">New code: copy it now</p>
      <p className="cx-minted-code cx-mono">{code}</p>
      <p className="cx-muted cx-small">
        This is the only time the code is shown. Send it to the person it is for
        {link ? (
          <>
            , with the start page: <span className="cx-mono">{link}</span>
          </>
        ) : (
          ". No start page is configured on this deployment (CIVIC_START_HOSTNAME), so it cannot be used yet"
        )}
        .
      </p>
      <div className="cx-actions">
        <button
          type="button"
          className="cx-btn cx-btn-primary"
          onClick={() => {
            void navigator.clipboard?.writeText(message).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : link ? "Copy code and link" : "Copy code"}
        </button>
        <button type="button" className="cx-btn cx-btn-quiet" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function Invites() {
  const [list, setList] = useState<InviteList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  function load() {
    api
      .invites()
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }
  useEffect(load, []);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.mintInvite(note.trim(), days === "" ? (list?.default_days ?? 14) : days);
      setMinted(r.code);
      setNote("");
      setDays("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invite: Invite) {
    const who = invite.note ? ` (${invite.note})` : "";
    if (!window.confirm(`Revoke the code ending ${invite.code_hint}${who}? It can no longer be used.`)) return;
    setError(null);
    try {
      const r = await api.revokeInvite(invite.id);
      setList((l) => (l ? { ...l, invites: r.invites } : l));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section>
      <h1 className="cx-title">Invite codes</h1>
      <p className="cx-muted cx-invite-card">
        A code lets one person create one demo hub on the start page
        {list?.start_hostname ? (
          <>
            {" "}(<span className="cx-mono">{list.start_hostname}</span>)
          </>
        ) : null}{" "}
        and become its admin. It is used only once the hub exists.
      </p>
      {list && !list.start_hostname && (
        <p className="cx-alert cx-alert-warn" role="alert">
          No start page is configured on this deployment (CIVIC_START_HOSTNAME is not set). Codes can be minted, but
          nobody can use them here yet.
        </p>
      )}

      {minted ? (
        <Minted code={minted} startHost={list?.start_hostname ?? null} onDone={() => setMinted(null)} />
      ) : (
        <form
          className="cx-card cx-form cx-invite-card"
          onSubmit={(e) => {
            e.preventDefault();
            void mint();
          }}
        >
          <div className="cx-two">
            <label className="cx-field">
              <span>
                Who it's for <em>optional</em>
              </span>
              <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Sam, county planning office" />
              <small className="cx-muted">Only you see this, in this list and the audit log.</small>
            </label>
            <label className="cx-field">
              <span>Lasts (days)</span>
              <input
                type="number"
                min={1}
                max={list?.max_days ?? 90}
                value={days}
                placeholder={String(list?.default_days ?? 14)}
                onChange={(e) => setDays(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <small className="cx-muted">Unused after this, it expires.</small>
            </label>
          </div>
          <button className="cx-btn cx-btn-primary" disabled={busy || !list}>
            {busy ? "Minting…" : "Mint a code"}
          </button>
        </form>
      )}

      {error && (
        <p className="cx-alert cx-alert-error" role="alert">
          {error}
        </p>
      )}

      {!list && !error && <p className="cx-muted">Loading…</p>}
      {list && list.invites.length === 0 && <p className="cx-muted">No codes yet.</p>}
      {list && list.invites.length > 0 && (
        <div className="cx-table-wrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">For</th>
                <th scope="col">Status</th>
                <th scope="col">Hub</th>
                <th scope="col" className="cx-hide-sm">Made</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {list.invites.map((inv) => (
                <tr key={inv.id}>
                  <td className="cx-mono cx-nowrap">…{inv.code_hint}</td>
                  <td className="cx-break">{inv.note ?? <span className="cx-muted">—</span>}</td>
                  <td>
                    <StatusBadge status={inv.status} />
                    <small className="cx-muted cx-block-text">
                      {inv.status === "unused" && `until ${day(inv.expires_at)}`}
                      {inv.status === "expired" && `on ${day(inv.expires_at)}`}
                      {inv.status === "revoked" && inv.revoked_at && `on ${day(inv.revoked_at)}`}
                    </small>
                  </td>
                  <td className="cx-break">
                    {inv.redemptions.length === 0 && <span className="cx-muted">—</span>}
                    {inv.redemptions.map((r) => (
                      <div key={r.at}>
                        {r.hub_id ? (
                          <a className="cx-mono" href={href({ name: "hub", id: r.hub_id })}>
                            {r.hub_id}
                          </a>
                        ) : (
                          "—"
                        )}
                        <small className="cx-muted cx-block-text">
                          by {r.email}, {when(r.at)}
                        </small>
                      </div>
                    ))}
                  </td>
                  <td className="cx-hide-sm cx-muted cx-nowrap">{day(inv.created_at)}</td>
                  <td>
                    {inv.status === "unused" && (
                      <button type="button" className="cx-btn cx-btn-quiet" onClick={() => void revoke(inv)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
