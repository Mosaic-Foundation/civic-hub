import { useEffect, useMemo, useState } from "react";
import { listProcessEdits, type ProcessEdit } from "../services/api";
import { stripMarkdown } from "../../../src/shared/markdown";
import { wordDiff } from "./wordDiff";
import "./EditHistory.css";

/**
 * "Edited September 5 · See what changed" — the visible history of a live
 * process, one edit at a time. Opens on the most recent edit; ‹ › step back
 * through earlier ones (Adam, 2026-09-03: ten edits must not become a
 * scroll of before/after blocks). Text fields show a word diff — removed
 * words struck through, added words highlighted — on the stripped text so
 * it reads as prose; list fields show what was removed and added.
 *
 * Works for any process id (reads the edit events the shared edit service
 * records) and renders nothing where nothing was edited.
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

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) =>
    typeof v === "object" && v && "to_id" in (v as object)
      ? `${(v as { relation: string }).relation} → ${(v as { to_id: string }).to_id}`
      : String(v),
  );
}

function TextDiff({ before, after }: { before: string; after: string }) {
  const runs = useMemo(() => wordDiff(stripMarkdown(before), stripMarkdown(after)), [before, after]);
  return (
    <p className="edit-diff">
      {runs.map((r, i) =>
        r.kind === "same" ? (
          <span key={i}>{r.text}</span>
        ) : r.kind === "removed" ? (
          <del key={i} className="edit-diff-removed">{r.text}</del>
        ) : (
          <ins key={i} className="edit-diff-added">{r.text}</ins>
        ),
      )}
    </p>
  );
}

function ListDiff({ before, after }: { before: string[]; after: string[] }) {
  const removed = before.filter((x) => !after.includes(x));
  const added = after.filter((x) => !before.includes(x));
  if (removed.length === 0 && added.length === 0) return <p className="edit-diff-none">Reordered only.</p>;
  return (
    <ul className="edit-diff-list">
      {removed.map((x, i) => (
        <li key={`r${i}`}><del className="edit-diff-removed">{x}</del></li>
      ))}
      {added.map((x, i) => (
        <li key={`a${i}`}><ins className="edit-diff-added">{x}</ins></li>
      ))}
    </ul>
  );
}

function ImageDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="edit-diff-images">
      {before ? <img src={before} alt="" className="edit-diff-image edit-diff-image--removed" /> : <span className="edit-diff-none">No banner</span>}
      <span className="edit-diff-arrow" aria-hidden="true">→</span>
      {after ? <img src={after} alt="" className="edit-diff-image edit-diff-image--added" /> : <span className="edit-diff-none">No banner</span>}
    </div>
  );
}

function FieldChange({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  let body;
  if (field === "banner_image_url") body = <ImageDiff before={asText(before)} after={asText(after)} />;
  else if (Array.isArray(before) || Array.isArray(after)) body = <ListDiff before={asList(before)} after={asList(after)} />;
  else body = <TextDiff before={asText(before)} after={asText(after)} />;
  return (
    <div className="edit-history-field">
      <h4>{label(field)}</h4>
      {body}
    </div>
  );
}

export default function EditHistory({ processId }: { processId: string }) {
  const [edits, setEdits] = useState<ProcessEdit[]>([]);
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#edits");
  // Index into edits (newest first): 0 = most recent.
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listProcessEdits(processId)
      .then((r) => { if (!cancelled) { setEdits(r.edits); setIndex(0); } })
      .catch(() => { /* history is a convenience on top of the record */ });
    return () => { cancelled = true; };
  }, [processId]);

  if (edits.length === 0) return null;
  const latest = edits[0];
  const current = edits[Math.min(index, edits.length - 1)];
  const total = edits.length;
  // Human numbering: oldest = 1 … newest = total.
  const number = total - index;

  return (
    <section className="edit-history" id="edits" aria-label="Edit history">
      <p className="edit-history-line">
        Edited {when(latest.at)} by {latest.editor_role === "admin" ? "a hub admin" : "the creator"}
        {total > 1 ? ` · ${total} edits` : ""}
        {" · "}
        <button type="button" className="edit-history-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide changes" : "See what changed"}
        </button>
      </p>

      {open && (
        <div className="edit-history-entry">
          <div className="edit-history-nav">
            <span className="edit-history-when">
              {total > 1 ? `Edit ${number} of ${total} · ` : ""}
              {when(current.at)} · {current.editor_role === "admin" ? "hub admin" : "creator"} · changed{" "}
              {current.changed_fields.map(label).join(", ").toLowerCase()}
            </span>
            {total > 1 && (
              <span className="edit-history-arrows">
                <button
                  type="button"
                  className="edit-history-arrow"
                  onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
                  disabled={index >= total - 1}
                  aria-label="Earlier edit"
                  title="Earlier edit"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="edit-history-arrow"
                  onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                  disabled={index === 0}
                  aria-label="Later edit"
                  title="Later edit"
                >
                  ›
                </button>
              </span>
            )}
          </div>
          <p className="edit-history-key">
            <del className="edit-diff-removed">removed</del> <ins className="edit-diff-added">added</ins>
          </p>
          {current.changed_fields.map((f) => (
            <FieldChange key={f} field={f} before={current.previous[f]} after={current.current[f]} />
          ))}
        </div>
      )}
    </section>
  );
}
