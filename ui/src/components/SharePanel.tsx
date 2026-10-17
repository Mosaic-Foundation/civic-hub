import { useId, useState } from "react";
import Modal from "./Modal";
import HelpButton from "./HelpButton";
import hub from "../config/hub";
import { useAuth } from "../context/AuthContext";
import { sendInvites, type InviteResult } from "../services/api";
import { ApiError } from "../utils/httpError";
import { defaultInviteMessage } from "../../../src/shared/inviteMessage";
import "./SharePanel.css";
import "./CocFindings.css";

/**
 * "Share this hub" (members and invites slice, Adam's design 2026-10-10,
 * decisions 2026-10-14): one panel for any signed-in member.
 *
 *   - Invite by email: several addresses at once, a message prefilled from
 *     the hub's intro and editable. Ten a day (fifty for an admin), never
 *     twice to one address. On a beta hub a member's invites go on the
 *     waitlist instead of being emailed; an admin's let the address in. A
 *     demo hub emails nobody, so the section isn't offered there.
 *   - Share the link: the phone's share sheet where there is one, copy link,
 *     Facebook (not on phones: it opens the app with no draft, see
 *     ShareButton), Nextdoor, WhatsApp, and a text message on phones.
 *
 * The answer never says which addresses were already invited or already
 * here: "Done" covers both, so the form can't tell a member who belongs.
 *
 * A message the member changed goes through the Code of Conduct check on
 * Send (the cleanup slice, 2026-10-16). Flagged, nothing is sent; what to
 * change shows under the message, which stays as written.
 */
export default function SharePanel({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const addressesId = useId();
  const messageId = useId();
  const hubUrl = `${window.location.origin}/`;
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState(defaultInviteMessage(hub.intro_body));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<MessageFinding[]>([]);
  const [copied, setCopied] = useState(false);

  const emailInvites = !hub.demo_mode;
  const toWaitlist = hub.beta_mode && !isAdmin;
  const limit = isAdmin ? 50 : 10;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFindings([]);
    setResult(null);
    try {
      const r = await sendInvites(emails, message);
      setResult(r);
      if (r.over_limit.length === 0 && r.failed === 0) setEmails("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "code_of_conduct_flagged") {
        const found = (err.body as { findings?: MessageFinding[] } | null)?.findings;
        setFindings(Array.isArray(found) ? found : []);
      }
      setError(err instanceof Error ? err.message : "The invites couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(hubUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy the link.");
    }
  }

  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isTouchDevice =
    typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const shareText = `Join me on ${hub.name}`;
  const encodedUrl = encodeURIComponent(hubUrl);

  return (
    <Modal title="Share this hub" onClose={onClose} dismissible={!busy} className="share-panel">
      {emailInvites && (
        <section className="share-panel-section" aria-labelledby={`${addressesId}-h`}>
          <h3 id={`${addressesId}-h`} className="share-panel-heading">
            Invite by email
            <HelpButton k="share.invites" label="Invite by email" />
          </h3>
          {toWaitlist && (
            <p className="form-hint share-panel-note">
              This hub is in private beta. Your invites go on its waitlist, marked as yours, and an admin lets them in.
              No email is sent yet.
            </p>
          )}
          <form onSubmit={send}>
            <label htmlFor={addressesId} className="share-panel-label">
              Email addresses
            </label>
            <textarea
              id={addressesId}
              className="share-panel-input"
              rows={2}
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="neighbour@example.com, friend@example.com"
              autoComplete="off"
              inputMode="email"
              disabled={busy}
            />
            <p className="form-hint">
              Separate addresses with commas or new lines. Up to {limit} a day. Nobody is invited twice.
            </p>
            {!toWaitlist && (
              <>
                <label htmlFor={messageId} className="share-panel-label">
                  Your message
                </label>
                <textarea
                  id={messageId}
                  className="share-panel-input"
                  rows={5}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setFindings([]);
                  }}
                  disabled={busy}
                  aria-describedby={`${messageId}-hint`}
                />
                {findings.length > 0 && (
                  <div className="field-finding" role="alert" data-testid="invite-message-finding">
                    {findings.map((f, i) => (
                      <p key={i} className="field-finding-text">
                        <strong>Code of Conduct:</strong> {f.message}
                        {f.quoted_text && (
                          <>
                            {" "}
                            <span className="field-finding-quote">“{f.quoted_text}”</span>
                          </>
                        )}
                      </p>
                    ))}
                  </div>
                )}
                <p id={`${messageId}-hint`} className="form-hint">
                  A message you change goes through a quick Code of Conduct check when you send.
                </p>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {result && <InviteOutcome result={result} />}
            <button type="submit" className="share-panel-send" disabled={busy || emails.trim() === ""}>
              {busy ? "Sending…" : toWaitlist ? "Add to the waitlist" : "Send invites"}
            </button>
          </form>
        </section>
      )}

      <section className="share-panel-section" aria-labelledby={`${messageId}-share`}>
        <h3 id={`${messageId}-share`} className="share-panel-heading">
          Share the link
        </h3>
        <div className="share-panel-targets">
          {hasNativeShare && (
            <button
              type="button"
              className="share-panel-target"
              onClick={() => navigator.share({ title: hub.name, url: hubUrl }).catch(() => {})}
            >
              Share…
            </button>
          )}
          <button type="button" className="share-panel-target" onClick={copy} aria-live="polite">
            {copied ? "Link copied" : "Copy link"}
          </button>
          {!isTouchDevice && (
            <a
              className="share-panel-target"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook
            </a>
          )}
          <a
            className="share-panel-target"
            href={`https://nextdoor.com/sharekit/?source=${encodeURIComponent(hub.name)}&body=${encodeURIComponent(`${shareText} ${hubUrl}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Nextdoor
          </a>
          <a
            className="share-panel-target"
            href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${hubUrl}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          {isTouchDevice && (
            <a className="share-panel-target" href={`sms:?&body=${encodeURIComponent(`${shareText} ${hubUrl}`)}`}>
              Text message
            </a>
          )}
        </div>
      </section>
    </Modal>
  );
}

/** One thing the Code of Conduct check found in the message. */
interface MessageFinding {
  message: string;
  quoted_text?: string | null;
}

function InviteOutcome({ result }: { result: InviteResult }) {
  const n = result.done;
  const people = (k: number) => (k === 1 ? "1 address" : `${k} addresses`);
  const lines: string[] = [];
  if (n > 0) {
    lines.push(
      result.outcome === "waitlisted"
        ? `Done: ${people(n)} on the waitlist. An admin can let them in.`
        : `Done: invites sent to ${people(n)}.`,
    );
  }
  if (result.over_limit.length > 0) {
    lines.push(
      `${people(result.over_limit.length)} not sent: that's today's ${result.limit}. Try ${result.over_limit.length === 1 ? "it" : "them"} again tomorrow: ${result.over_limit.join(", ")}.`,
    );
  }
  if (result.failed > 0) lines.push(`${people(result.failed)} couldn't be emailed just now. Try again later.`);
  return (
    <p className="settings-message share-panel-result" role="status">
      {lines.join(" ")}
    </p>
  );
}
