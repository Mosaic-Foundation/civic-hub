import { useEffect, useState } from "react";
import { listProcessEdits, type ProcessEdit } from "../services/api";
import RichText from "./RichText";
import "./EditHistory.css";

/**
 * "Edited September 5 · See what changed" — the visible history of a live
 * process. Reads the edit events the shared edit service records, so it
 * works for any process id and renders nothing where nothing was edited.
 * Mounted under the description on every detail page; today only projects
 * can be edited, so only projects ever show it.
 *
 * Supporters signed on to particular words, so every edit shows the
 * previous and current text of each changed field, newest first.
 */

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  sources: "Sources",
  banner_image_url: "Banner image",
  banner_image_alt: "Banner image description",
  links: "Related processes",
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function Value({ field, value }: { field: string; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="edit-history-empty">(empty)</span>;
  }
  if (field === "description") return <RichText text={String(value)} />;
  if (field === "banner_image_url") {
    return <img src={String(value)} alt="" className="edit-history-image" />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="edit-history-empty">(none)</span>;
    return (
      <ul className="edit-history-list">
        {value.map((v, i) => (
          <li key={i}>
            {typeof v === "object" && v && "to_id" in (v as object)
              ? `${(v as { relation: string }).relation} → ${(v as { to_id: string }).to_id}`
              : String(v)}
          </li>
        ))}
      </ul>
    );
  }
  return <span>{String(value)}</span>;
}

export default function EditHistory({ processId }: { processId: string }) {
  const [edits, setEdits] = useState<ProcessEdit[]>([]);
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#edits");

  useEffect(() => {
    let cancelled = false;
    listProcessEdits(processId)
      .then((r) => { if (!cancelled) setEdits(r.edits); })
      .catch(() => { /* history is a convenience on top of the record */ });
    return () => { cancelled = true; };
  }, [processId]);

  if (edits.length === 0) return null;
  const latest = edits[0];

  return (
    <section className="edit-history" id="edits" aria-label="Edit history">
      <p className="edit-history-line">
        Edited {when(latest.at)} by {latest.editor_role === "admin" ? "a hub admin" : "the creator"}
        {edits.length > 1 ? ` · ${edits.length} edits` : ""}
        {" · "}
        <button type="button" className="edit-history-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide changes" : "See what changed"}
        </button>
      </p>

      {open && (
        <ol className="edit-history-entries">
          {edits.map((e) => (
            <li key={e.id} className="edit-history-entry">
              <p className="edit-history-when">
                {when(e.at)} · {e.editor_role === "admin" ? "hub admin" : "creator"} · changed{" "}
                {e.changed_fields.map(label).join(", ").toLowerCase()}
              </p>
              {e.changed_fields.map((f) => (
                <div key={f} className="edit-history-field">
                  <h4>{label(f)}</h4>
                  <div className="edit-history-diff">
                    <div className="edit-history-before">
                      <span className="edit-history-tag">Before</span>
                      <Value field={f} value={e.previous[f]} />
                    </div>
                    <div className="edit-history-after">
                      <span className="edit-history-tag">After</span>
                      <Value field={f} value={e.current[f]} />
                    </div>
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
