// "Edit the wording": a document as a normal form (pilot readiness 2, Adam
// 2026-11-02). One labelled field per section of src/shared/documentFields.ts,
// each with Bold, Italic, the two lists and Link, and placeholders as locked
// chips. contentEditable rather than a textarea because a textarea can't hold a
// chip; the browser's editing commands do the work, so there is no dependency.
// Pasting brings the words only, so nothing arrives that the field can't hold.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, TextInput } from "../../../kit";
import { LegalBody } from "../../../components/LegalPage";
import { INSERTABLE_CHIPS, chipLabel, joinDocument, splitDocument, type DocumentPart } from "../../../../../src/shared/documentFields";
import { applySubstitutions } from "../../../../../src/shared/documentTemplate";
import { chipHtml, domToMarkdown, markdownToHtml } from "./editorMarkdown";
import "./DocumentEditor.css";

function RichField({
  label,
  text,
  disabled,
  onText,
}: {
  label: string;
  text: string;
  disabled: boolean;
  /** The field's new text, or null when it reads as it did at the start. */
  onText: (text: string | null) => void;
}) {
  const labelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const baseline = useRef("");
  const range = useRef<Range | null>(null);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("https://");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = markdownToHtml(text);
    baseline.current = domToMarkdown(el);
    // Once: the element is the field's state from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function report() {
    const el = box.current;
    if (!el) return;
    const now = domToMarkdown(el);
    onText(now === baseline.current ? null : now);
  }

  function keepSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && box.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    box.current?.focus();
    if (range.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range.current);
    }
  }

  function command(name: string, value?: string) {
    restoreSelection();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(name, false, value);
    report();
  }

  /** A chip at the caret, by hand: the browsers' insertHTML breaks the line around one. */
  function insertChip(token: string) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const at = sel.getRangeAt(0);
    at.deleteContents();
    const holder = document.createElement("template");
    holder.innerHTML = chipHtml(token);
    const space = document.createTextNode("\u00a0");
    at.insertNode(space);
    at.insertNode(holder.content);
    at.setStartAfter(space);
    at.collapse(true);
    sel.removeAllRanges();
    sel.addRange(at);
    keepSelection();
    report();
  }

  function addLink() {
    const url = href.trim();
    setLinking(false);
    setHref("https://");
    if (/^(https?:\/\/\S+|mailto:\S+|\/\S*)$/.test(url)) command("createLink", url);
  }

  // A toolbar press mustn't take the focus, or the selection goes with it.
  const hold = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="doc-field">
      <span id={labelId} className="form-label doc-field-label">
        {label}
      </span>
      <div className="doc-toolbar" role="toolbar" aria-label={`Format ${label}`} onMouseDown={hold}>
        <Button variant="ghost" size="sm" aria-label="Bold" disabled={disabled} onClick={() => command("bold")}>
          <strong>B</strong>
        </Button>
        <Button variant="ghost" size="sm" aria-label="Italic" disabled={disabled} onClick={() => command("italic")}>
          <em>I</em>
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => command("insertUnorderedList")}>
          Bullets
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => command("insertOrderedList")}>
          Numbers
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            keepSelection();
            setLinking(true);
          }}
        >
          Link
        </Button>
        <span className="doc-toolbar-chips">
          Insert:
          {INSERTABLE_CHIPS.map((t) => (
            <button key={t} type="button" className="doc-chip doc-chip-button" disabled={disabled} onClick={() => insertChip(t)}>
              {chipLabel(t)}
            </button>
          ))}
        </span>
      </div>
      {linking && (
        <div className="doc-link-row">
          <TextInput
            aria-label="Link address"
            value={href}
            autoFocus
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <Button size="sm" onClick={addLink}>
            Add link
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLinking(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div
        ref={box}
        className="form-textarea doc-field-box"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={report}
        onBlur={keepSelection}
        onKeyUp={keepSelection}
        onMouseUp={keepSelection}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          report();
        }}
        onDrop={(e) => e.preventDefault()}
      />
    </div>
  );
}

export default function DocumentEditor({
  value,
  kind,
  byParagraph,
  values,
  disabled,
  onChange,
}: {
  /** The document when the editor opened. It keeps its own fields from then on. */
  value: string;
  kind: string | undefined;
  byParagraph?: boolean;
  /** The hub's values, for a heading that names one. */
  values: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange: (document: string) => void;
}) {
  const parts = useMemo<DocumentPart[]>(() => splitDocument(value, kind, { byParagraph }), [value, kind, byParagraph]);
  const edits = useRef<Record<string, string>>({});

  return (
    <div className="doc-editor">
      {parts.map((p) => {
        if (p.type === "fixed") return null;
        const label = applySubstitutions(p.label, values);
        if (p.type === "locked") {
          return (
            <div key={p.id} className="doc-field">
              <span className="form-label doc-field-label">{label}</span>
              <div className="doc-locked">
                <LegalBody>{applySubstitutions(p.text, values)}</LegalBody>
              </div>
              <p className="form-hint">This part has formatting this editor can't change, so it stays as it is.</p>
            </div>
          );
        }
        return (
          <RichField
            key={p.id}
            label={label}
            text={p.text}
            disabled={disabled}
            onText={(text) => {
              if (text === null) delete edits.current[p.id];
              else edits.current[p.id] = text;
              onChange(joinDocument(parts, edits.current));
            }}
          />
        );
      })}
    </div>
  );
}
