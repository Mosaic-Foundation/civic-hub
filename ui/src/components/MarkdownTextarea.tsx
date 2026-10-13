import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import RichText from "./RichText";
import { onScreen, SETTLE_MS } from "../utils/editingInView";
import "./MarkdownTextarea.css";

/**
 * A plain textarea with a small formatting toolbar above it — Bold,
 * Italic, Section, Bullets, Numbered, Link — and a Preview toggle that
 * renders with the same RichText the public page uses.
 *
 * Drop-in for any <textarea>: every prop passes through (id, defaultValue
 * or value, onChange, placeholder, rows, disabled), so the four drafting
 * forms and the project-update box keep their own change handling. The
 * toolbar edits the textarea's value through the native setter and fires
 * an `input` event, which React reports as onChange — the form never
 * knows the difference between typing and a toolbar click. The assistant's
 * Apply writes by element id (draft-description), which is preserved.
 *
 * Kept as a textarea on purpose: phones, autosave debouncing, and the
 * assistant's field patching all already work against one.
 */

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function wrapSelection(el: HTMLTextAreaElement, before: string, after: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const selected = value.slice(s, e) || placeholder;
  const next = value.slice(0, s) + before + selected + after + value.slice(e);
  setNativeValue(el, next);
  el.focus();
  el.setSelectionRange(s + before.length, s + before.length + selected.length);
}

function prefixLines(el: HTMLTextAreaElement, prefix: (i: number) => string) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const lineEndIdx = value.indexOf("\n", e);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd) || "Item";
  const lines = block.split("\n").map((l, i) => (l.trim() ? prefix(i) + l.replace(/^\s*([-*+]|\d+[.)])\s+/, "") : l));
  const replaced = lines.join("\n");
  // A list needs a blank line before it when it follows text.
  const needsGap = lineStart > 0 && value[lineStart - 1] === "\n" && value[lineStart - 2] !== "\n" && value.slice(0, lineStart).trim();
  const next = value.slice(0, lineStart) + (needsGap ? "\n" : "") + replaced + value.slice(lineEnd);
  setNativeValue(el, next);
  el.focus();
  const start = lineStart + (needsGap ? 1 : 0);
  el.setSelectionRange(start, start + replaced.length);
}

function sectionLabel(el: HTMLTextAreaElement) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const selected = value.slice(s, e).trim() || "Section label";
  const before = value.slice(0, s);
  const after = value.slice(e);
  const lead = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}**${selected}**${tail}`;
  setNativeValue(el, before + inserted + after);
  el.focus();
  const start = s + lead.length + 2;
  el.setSelectionRange(start, start + selected.length);
}

/**
 * At phone width, while the textarea has focus and is on screen, the toolbar
 * docks as one row directly above the keyboard (Submit and Save, phone
 * layout). Its offset from the bottom is the keyboard's height, read from the
 * visual viewport. iOS reports that late while the page moves, so the toolbar
 * hides while anything moves and is placed once it is still; scrolled away
 * from its field (cursor still in it) it stays hidden and the pinned bar,
 * with Submit, is back (Adam, 2026-10-13).
 */
function useKeyboardDock(
  focused: boolean,
  field: React.RefObject<HTMLTextAreaElement | null>,
): { docked: boolean; bottom: number; shown: boolean } {
  const [bottom, setBottom] = useState(0);
  const [shown, setShown] = useState(false);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    // `shown` only matters while docked; it is decided afresh on every dock.
    if (!focused || !phone || !vv) return;
    const settleNow = () => {
      setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      setShown(field.current ? onScreen(field.current) : false);
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      setShown(false);
      clearTimeout(settle);
      settle = setTimeout(settleNow, SETTLE_MS);
    };
    settleNow();
    vv.addEventListener("resize", onMove);
    vv.addEventListener("scroll", onMove);
    window.addEventListener("scroll", onMove, { passive: true });
    return () => {
      clearTimeout(settle);
      vv.removeEventListener("resize", onMove);
      vv.removeEventListener("scroll", onMove);
      window.removeEventListener("scroll", onMove);
    };
  }, [focused, phone, field]);
  return { docked: focused && phone, bottom, shown };
}

export default function MarkdownTextarea(props: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [focused, setFocused] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const { docked, bottom, shown } = useKeyboardDock(focused, ref);

  const act = (fn: (el: HTMLTextAreaElement) => void) => () => {
    const el = ref.current;
    if (!el || props.disabled) return;
    fn(el);
  };

  function togglePreview() {
    setPreviewText(ref.current?.value ?? "");
    setPreview((p) => !p);
  }

  return (
    <div className={`md-editor${preview ? " md-editor--preview" : ""}`}>
      {docked && <div className="md-toolbar-spacer" style={{ height: toolbarHeight }} aria-hidden="true" />}
      <div
        ref={toolbarRef}
        className={`md-toolbar${docked ? ` md-toolbar--docked${shown ? "" : " is-moving"}` : ""}`}
        style={docked ? { bottom } : undefined}
        role="toolbar"
        aria-label="Formatting"
        // A tap on a tool must not take focus from the field: the keyboard
        // would close and the toolbar would undock under the finger.
        onMouseDown={(e) => e.preventDefault()}
      >
        <button type="button" className="md-tool md-tool--bold" title="Bold" aria-label="Bold" onClick={act((el) => wrapSelection(el, "**", "**", "bold text"))}>B</button>
        <button type="button" className="md-tool md-tool--italic" title="Italic" aria-label="Italic" onClick={act((el) => wrapSelection(el, "*", "*", "italic text"))}>I</button>
        <button type="button" className="md-tool" title="Section label on its own line" onClick={act(sectionLabel)}>Section</button>
        <button type="button" className="md-tool" title="Bulleted list" onClick={act((el) => prefixLines(el, () => "- "))}>• List</button>
        <button type="button" className="md-tool" title="Numbered list" onClick={act((el) => prefixLines(el, (i) => `${i + 1}. `))}>1. List</button>
        <button type="button" className="md-tool" title="Link" onClick={act((el) => wrapSelection(el, "[", "](https://)", "link text"))}>Link</button>
        <button
          type="button"
          className={`md-tool md-tool--preview${preview ? " is-on" : ""}`}
          aria-pressed={preview}
          onClick={togglePreview}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      <textarea
        {...props}
        ref={ref}
        className={`${props.className ?? ""} md-textarea${preview ? " md-textarea--hidden" : ""}`.trim()}
        onInput={(e) => {
          if (preview) setPreviewText((e.target as HTMLTextAreaElement).value);
          props.onInput?.(e);
        }}
        onFocus={(e) => {
          setToolbarHeight(toolbarRef.current?.offsetHeight ?? 0);
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
      />

      {preview && (
        <div className="md-preview" aria-live="polite">
          <RichText text={previewText} />
          {!previewText.trim() && <p className="md-preview-empty">Nothing to preview yet.</p>}
        </div>
      )}

      <p className="md-hint">
        <strong>**bold**</strong>, <em>*italic*</em>, "- " for a list, "1. " for numbered.
      </p>
    </div>
  );
}
