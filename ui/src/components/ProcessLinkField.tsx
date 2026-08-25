import { useState } from "react";
import {
  type LinkCandidate,
  type ProposedLink,
  type RelationType,
} from "../services/api";
import ProcessLinkPicker, { friendlyType } from "./ProcessLinkPicker";
import "./ProcessLinkField.css";

/**
 * Creation-time linking, for a drafting form.
 *
 * Unlike RelatedProcesses (which reads and writes the server), this is a plain
 * controlled field: the picked links live on the draft and are materialized
 * into process_links at submission. That is what lets a resident propose a
 * relationship as part of what they wrote, and an admin review it alongside
 * everything else in the submission.
 *
 * ALWAYS OPTIONAL. There is no validation that wants this filled in, and the
 * copy says so.
 */

const RELATION_LABELS: Record<RelationType, string> = {
  continues: "Continues",
  references: "References",
  implements: "Implements",
};

interface Props {
  value: ProposedLink[];
  onChange: (links: ProposedLink[]) => void;
  /** Titles for already-picked links, so removing and re-rendering doesn't
   *  need a server round-trip. */
  titles: Record<string, { title: string; type: string }>;
  onTitlesChange: (titles: Record<string, { title: string; type: string }>) => void;
  seedTitle?: string;
  seedDescription?: string;
  disabled?: boolean;
}

export default function ProcessLinkField({
  value,
  onChange,
  titles,
  onTitlesChange,
  seedTitle = "",
  seedDescription = "",
  disabled = false,
}: Props) {
  const [picking, setPicking] = useState(false);

  function handlePick(link: ProposedLink, peer: LinkCandidate) {
    // Same target + same relation twice is a slip, not an intent.
    const exists = value.some(
      (l) => l.to_id === link.to_id && l.relation === link.relation,
    );
    if (!exists) {
      onChange([...value, link]);
      onTitlesChange({ ...titles, [peer.id]: { title: peer.title, type: peer.type } });
    }
    setPicking(false);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="link-field">
      <div className="link-field__header">
        <span className="link-field__label">Related processes</span>
        <span className="link-field__optional">Optional</span>
      </div>
      <p className="link-field__help">
        Is this connected to something already happening? Linking it helps
        people follow the thread. You can skip this.
      </p>

      {value.length > 0 && (
        <ul className="link-field__list">
          {value.map((link, i) => {
            const peer = titles[link.to_id];
            return (
              <li key={`${link.to_id}-${link.relation}`} className="link-field__item">
                <span className="link-field__relation">
                  {RELATION_LABELS[link.relation]}
                </span>
                <span className="link-field__title">
                  {peer?.title ?? link.to_id}
                </span>
                {peer && (
                  <span className="link-field__type">{friendlyType(peer.type)}</span>
                )}
                <button
                  type="button"
                  className="link-field__remove"
                  aria-label={`Remove link to ${peer?.title ?? link.to_id}`}
                  disabled={disabled}
                  onClick={() => remove(i)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picking ? (
        <ProcessLinkPicker
          exclude={value.map((l) => l.to_id)}
          seedTitle={seedTitle}
          seedDescription={seedDescription}
          onPick={handlePick}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button
          type="button"
          className="link-field__add"
          disabled={disabled}
          onClick={() => setPicking(true)}
        >
          + Link a related process
        </button>
      )}
    </div>
  );
}
