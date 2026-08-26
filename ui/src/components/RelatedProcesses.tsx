import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  addProcessLink,
  getProcessLinks,
  removeProcessLink,
  type LinkCandidate,
  type ProcessLinks,
  type ProposedLink,
  type RenderedLink,
} from "../services/api";
import ProcessLinkPicker, { friendlyType } from "./ProcessLinkPicker";
import "./RelatedProcesses.css";

/**
 * "Related" panel for a process detail page.
 *
 * UNIVERSAL. Mount it with a process id and it works — for every process type
 * that exists now and every one added later. It never asks what kind of
 * process it is on.
 *
 * BOTH DIRECTIONS FROM ONE STORED EDGE. The forward links this process
 * authored and the backlinks other processes pointed at it are the same rows
 * read from opposite ends. Nothing is written twice, so nothing can fall out
 * of step.
 *
 * Renders nothing at all when there are no links and the viewer can't add any
 * — an empty "Related" heading is just noise on a page.
 */

interface Props {
  processId: string;
  /**
   * Display-only. Backlinks still render so a reader can follow the thread,
   * but no add or remove control appears.
   *
   * Used on content posts (announcements, meeting summaries): a process may
   * link TO them, and they show the counter-link, but they never originate
   * links of their own.
   */
  readOnly?: boolean;
  /** Type of this process — sets the picker's default relation. */
  processType?: string;
  /** Seeds auto-suggestions in the picker. */
  title?: string;
  description?: string;
}

export default function RelatedProcesses({
  processId,
  title = "",
  description = "",
  readOnly = false,
  processType,
}: Props) {
  const [links, setLinks] = useState<ProcessLinks>({ outgoing: [], incoming: [] });
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await getProcessLinks(processId));
    } catch {
      // A failed link read must never take the page down with it — the
      // process itself is what the reader came for.
      setLinks({ outgoing: [], incoming: [] });
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Server-decided: the creator of this process, or an admin. `readOnly`
  // overrides it for surfaces that display links but never originate them.
  const canEdit = !readOnly && links.can_edit === true;

  async function handlePick(link: ProposedLink, _peer: LinkCandidate) {
    setBusy(true);
    setError(null);
    try {
      const next = await addProcessLink(processId, link);
      setLinks({ outgoing: next.outgoing, incoming: next.incoming, can_edit: next.can_edit });
      setPicking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(linkId: string) {
    setBusy(true);
    setError(null);
    try {
      setLinks(await removeProcessLink(processId, linkId));
      setConfirmRemove(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the link.");
    } finally {
      setBusy(false);
    }
  }

  const all = [...links.outgoing, ...links.incoming];
  const excluded = [processId, ...all.map((l) => l.peer.id)];

  if (loading) return null;
  if (all.length === 0 && !canEdit) return null;

  return (
    <section className="related-processes" aria-labelledby="related-processes-heading">
      <div className="related-processes__header">
        <h2 id="related-processes-heading" className="related-processes__heading">
          Related
        </h2>
        {canEdit && !picking && (
          <button
            type="button"
            className="related-processes__add"
            onClick={() => setPicking(true)}
          >
            + Add a related process
          </button>
        )}
      </div>

      {all.length === 0 && !picking && !readOnly && (
        <p className="related-processes__empty">
          Nothing linked yet. Connecting this to a related community process
          helps people follow the topic across processes.
        </p>
      )}

      {error && <p className="related-processes__error">{error}</p>}

      {picking && (
        <ProcessLinkPicker
          exclude={excluded}
          seedTitle={title}
          seedDescription={description}
          processType={processType}
          busy={busy}
          onPick={handlePick}
          onCancel={() => setPicking(false)}
        />
      )}

      {all.length > 0 && (
        <ul className="related-processes__list">
          {all.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              canEdit={canEdit && !link.synthetic && !link.inherited}
              busy={busy}
              confirming={confirmRemove === link.id}
              onAskRemove={() => setConfirmRemove(link.id)}
              onCancelRemove={() => setConfirmRemove(null)}
              onConfirmRemove={() => handleRemove(link.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkRow({
  link,
  canEdit,
  busy,
  confirming,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  link: RenderedLink;
  canEdit: boolean;
  busy: boolean;
  confirming: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  return (
    <li
      className={
        `related-processes__item related-processes__item--${link.direction}` +
        (link.synthetic || link.inherited ? " related-processes__item--derived" : "")
      }
    >
      <div className="related-processes__item-main">
        <span className="related-processes__relation">{link.label}</span>
        <Link to={link.peer.href} className="related-processes__peer">
          {link.peer.title}
        </Link>
        <span className="related-processes__type">{friendlyType(link.peer.type)}</span>
      </div>

      {canEdit &&
        (confirming ? (
          <span className="related-processes__confirm">
            <button
              type="button"
              className="related-processes__confirm-yes"
              disabled={busy}
              onClick={onConfirmRemove}
            >
              Remove
            </button>
            <button
              type="button"
              className="related-processes__confirm-no"
              onClick={onCancelRemove}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="related-processes__remove"
            aria-label={`Remove link to ${link.peer.title}`}
            onClick={onAskRemove}
          >
            ×
          </button>
        ))}
    </li>
  );
}
