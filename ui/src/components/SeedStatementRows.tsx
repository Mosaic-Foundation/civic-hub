// Seed statements as numbered rows — one statement per row, Enter makes the
// next one, pasting several lines splits into rows. A repeat never becomes a
// row: paste and the assistant/draft-load drop duplicates as they come in, so
// the creator never sees a flagged "this one won't count" row to clean up
// (Adam, 2026-09-05: "cleaner just to not include repeats in the display").
// The backend's submit-time dedupe stays as the backstop for the rare case of
// hand-typing the same statement twice.
//
// This is a UI over the SAME newline-separated string the field has always
// been. Rows are derived from that string and joined back into it; nothing
// downstream changes — the draft column, the controller's split at submit
// (deliberationDraftController), the assistant's one-statement-per-line
// suggestion card, and Apply-suggestion (which edits the string and lets the
// rows re-derive) are all untouched. Adam, 2026-09-05, on the plain textarea:
// "some little more distinguishment between one seed statement and the next
// … when they hit enter that next definitive row marker is generated."
//
// The one hazard of a rows-over-string design is the round trip: the form
// debounces saves, the server echoes the saved draft back, and a stale echo
// arriving mid-typing must NOT overwrite newer rows. So a prop change is
// applied only when it is something we never emitted ourselves — the
// assistant applying a suggestion, a draft being loaded — and an echo of our
// own edit, however late, is ignored. See `emitted` below.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import "./SeedStatementRows.css";

// Cap on how many statements a creator adds here. It is a GROWTH cap, not a
// truncation: the Add button, Enter, and paste all refuse to push past it,
// and the assistant is told the same limit (deliberationAssistantConfig) — but
// a value arriving with more (a legacy draft from before the cap) is shown in
// full rather than silently losing the creator's content. Adam, 2026-09-05:
// "cap it at eight or something … an add statement button they can keep
// adding until they get to eight."
const MAX_SEEDS = 8;

interface Props {
  /** The newline-separated field value. */
  value: string;
  /** Receives the normalized value: trimmed rows, empties dropped, "\n"-joined. */
  onChange: (value: string) => void;
  /** Goes on the first row, so the field's <label htmlFor> still lands. */
  id: string;
  /** The label element's id, for the group. */
  labelledBy: string;
  placeholder?: string;
  disabled?: boolean;
}

/** One row per non-empty line; always at least one row to type into. */
function parseRows(value: string): string[] {
  const rows = value.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  return rows.length > 0 ? rows : [""];
}

/** The field's canonical serialization — what the controller will split. */
function normalize(rows: string[]): string {
  return rows.map((s) => s.trim()).filter((s) => s.length > 0).join("\n");
}

/** Mirrors the controller's dedupe key: case- and whitespace-insensitive. */
function dedupeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop rows that repeat an earlier one (first occurrence wins), and drop
 *  empties. Used at every point content arrives from somewhere other than a
 *  keystroke — paste, an applied suggestion, a loaded draft — so a duplicate
 *  never becomes a visible row. Mirrors the controller's dedupe key. */
function dropDuplicates(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = dedupeKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Fit a row's height to its text, so a long statement wraps instead of
 *  scrolling inside a fixed box. An EMPTY row is left to the CSS min-height
 *  rather than measured: Chromium counts a textarea's placeholder toward
 *  scrollHeight, so measuring an empty row would inflate it to fit the
 *  placeholder (and only the first row carries one). */
function grow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  if (el.value.length === 0) {
    el.style.height = "";
    return;
  }
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

type Caret = number | "end";

export default function SeedStatementRows({
  value,
  onChange,
  id,
  labelledBy,
  placeholder,
  disabled = false,
}: Props) {
  const [rows, setRows] = useState<string[]>(() => {
    const deduped = dropDuplicates(parseRows(value));
    return deduped.length > 0 ? deduped : [""];
  });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const inputs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const pendingFocus = useRef<{ index: number; caret: Caret } | null>(null);

  // Normalized values this component has sent up, most recent last. A prop
  // change equal to any of them is an echo of our own edit (the debounced
  // save coming back from the server, possibly behind newer typing) and is
  // ignored. Anything else is a genuine external change and replaces the
  // rows. Bounded so it cannot grow with a long editing session.
  const emitted = useRef<string[]>([]);

  const emit = useCallback(
    (next: string[]) => {
      setRows(next);
      const normalized = normalize(next);
      emitted.current.push(normalized);
      if (emitted.current.length > 40) emitted.current.shift();
      onChange(normalized);
    },
    [onChange],
  );

  useEffect(() => {
    // External content — a loaded draft, an applied suggestion — is deduped as
    // it arrives, so a repeat never becomes a row. The comparison also dedupes
    // the CURRENT rows, so a duplicate the creator hand-typed does not force an
    // adoption that would then yank it out from under them (it stays put and
    // the backend drops it at submit); only genuinely new content replaces.
    const incomingRows = dropDuplicates(parseRows(value));
    const incoming = normalize(incomingRows);
    if (incoming === normalize(dropDuplicates(rowsRef.current))) return;
    if (emitted.current.includes(incoming)) return; // our own edit, echoed
    // An EMPTY incoming value never replaces local rows. Creating the draft
    // server-side echoes back seed_statements:"" before the debounced field
    // save lands, and that stale baseline would wipe what the person just
    // typed. Clearing is always a local action (it goes through emit and so is
    // already showing); the only external changes worth adopting carry content.
    if (incoming.length === 0) return;
    setRows(incomingRows.length > 0 ? incomingRows : [""]);
  }, [value]);

  // After any change: size every row to its text, then honour a requested
  // focus (the row Enter just made, the previous row after a Backspace…).
  useLayoutEffect(() => {
    inputs.current.forEach(grow);
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const el = inputs.current[want.index];
    if (!el) return;
    el.focus();
    const pos = want.caret === "end" ? el.value.length : want.caret;
    el.setSelectionRange(pos, pos);
  }, [rows]);

  const setRow = (i: number, text: string) => {
    const next = rows.slice();
    next[i] = text;
    emit(next);
  };

  const insertAfter = (i: number, texts: string[], focusCaret: Caret) => {
    const next = [...rows.slice(0, i + 1), ...texts, ...rows.slice(i + 1)];
    pendingFocus.current = { index: i + texts.length, caret: focusCaret };
    emit(next);
  };

  const remove = (i: number) => {
    if (rows.length === 1) {
      // The only row: clear it rather than leave nothing to type into.
      pendingFocus.current = { index: 0, caret: "end" };
      emit([""]);
      return;
    }
    const next = rows.filter((_, idx) => idx !== i);
    pendingFocus.current = { index: Math.max(0, i - 1), caret: "end" };
    emit(next);
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let a composing IME (e.g. Japanese input) finish its own Enter.
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;

    if (e.key === "Enter" && !e.shiftKey) {
      // Split at the caret: what follows it becomes the new row.
      e.preventDefault();
      if (rows.length >= MAX_SEEDS) return; // at the cap — no new row

      const at = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, at);
      const after = el.value.slice(at);
      const next = rows.slice();
      next[i] = before;
      next.splice(i + 1, 0, after);
      pendingFocus.current = { index: i + 1, caret: 0 };
      emit(next);
      return;
    }

    if (e.key === "Backspace" && i > 0 && el.selectionStart === 0 && el.selectionEnd === 0) {
      // At the very start of a row: join it onto the previous one, caret at
      // the seam — the inverse of Enter. An empty row simply disappears.
      e.preventDefault();
      const prev = rows[i - 1];
      const next = rows.slice();
      next[i - 1] = prev + el.value;
      next.splice(i, 1);
      pendingFocus.current = { index: i - 1, caret: prev.length };
      emit(next);
    }
  };

  const onPaste = (i: number) => (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n") && !text.includes("\r")) return; // ordinary paste
    // Several lines: each becomes a row, spliced in at the caret. People
    // paste these from notes, and the one thing that must not happen is all
    // of it landing in one row with the breaks silently lost.
    e.preventDefault();
    let lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (lines.length === 0) return;
    // Drop lines that repeat each other or a statement already in the list
    // (every row except the one being pasted into, which this paste replaces),
    // so a paste never introduces a duplicate row.
    const existing = new Set(
      rows.filter((_, idx) => idx !== i).map(dedupeKey).filter(Boolean),
    );
    lines = lines.filter((line) => {
      const key = dedupeKey(line);
      if (!key || existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (lines.length === 0) return;
    // Never let a paste push the total past the cap; take only what fits.
    const room = Math.max(0, MAX_SEEDS - (rows.length - 1));
    lines = lines.slice(0, Math.max(1, room));
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = rows.slice();
    if (lines.length === 1) {
      next[i] = before + lines[0] + after;
      pendingFocus.current = { index: i, caret: (before + lines[0]).length };
      emit(next);
      return;
    }
    const last = lines[lines.length - 1];
    next[i] = before + lines[0];
    next.splice(i + 1, 0, ...lines.slice(1, -1), last + after);
    pendingFocus.current = { index: i + lines.length - 1, caret: last.length };
    emit(next);
  };

  const kept = rows.filter((r) => r.trim().length > 0).length;

  return (
    <div className="seed-rows" role="group" aria-labelledby={labelledBy}>
      <ol className="seed-rows-list">
        {rows.map((row, i) => {
          return (
            <li key={i} className="seed-row">
              <span className="seed-row-num" aria-hidden="true">
                {i + 1}.
              </span>
              <div className="seed-row-body">
                <textarea
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  id={i === 0 ? id : undefined}
                  // Tells Apply-suggestion (useDraftFlow) not to write into
                  // this element directly; the value arrives via the prop.
                  data-controlled="true"
                  className="form-input seed-row-input"
                  value={row}
                  rows={1}
                  onChange={(e) => {
                    grow(e.currentTarget);
                    setRow(i, e.currentTarget.value);
                  }}
                  onKeyDown={onKeyDown(i)}
                  onPaste={onPaste(i)}
                  placeholder={i === 0 && rows.length === 1 ? placeholder : undefined}
                  aria-label={`Statement ${i + 1}`}
                  enterKeyHint="next"
                  disabled={disabled}
                />
              </div>
              <button
                type="button"
                className="seed-row-remove"
                onClick={() => remove(i)}
                disabled={disabled}
                aria-label={`Remove statement ${i + 1}`}
                title="Remove"
              >
                &times;
              </button>
            </li>
          );
        })}
      </ol>
      <div className="seed-rows-foot">
        {rows.length < MAX_SEEDS ? (
          <button
            type="button"
            className="seed-rows-add"
            onClick={() => insertAfter(rows.length - 1, [""], "end")}
            disabled={disabled}
          >
            + Add statement
          </button>
        ) : (
          <span className="seed-rows-max">Maximum of {MAX_SEEDS} statements</span>
        )}
        {kept > 0 && (
          <p className="seed-statement-count">
            {kept} statement{kept !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
