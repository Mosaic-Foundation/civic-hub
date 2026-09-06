import { useLayoutEffect, useRef } from "react";

/**
 * The title field, as an auto-growing textarea rather than a single-line
 * input. A long title used to scroll off the end of an <input> with no way to
 * see or edit the tail on a phone (Adam, 2026-09-05). This wraps and grows so
 * the whole title is always visible. It stays a ONE-LINE title semantically:
 * Enter is blocked and pasted newlines are flattened to spaces, so nothing
 * downstream (which treats title as a single line) sees a line break.
 *
 * Uncontrolled (defaultValue), like the inputs it replaces, so Apply-suggestion
 * can still write straight into #draft-title via the DOM.
 */
interface Props {
  id: string;
  defaultValue: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

function grow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export default function TitleField({
  id,
  defaultValue,
  onChange,
  placeholder,
  maxLength,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Size to content on mount (a resumed draft arrives with its title) and let
  // grow() handle every keystroke after.
  useLayoutEffect(() => {
    grow(ref.current);
  }, []);

  return (
    <textarea
      ref={ref}
      id={id}
      className="form-input title-field"
      rows={1}
      defaultValue={defaultValue}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      enterKeyHint="done"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault(); // a title is one line
      }}
      onChange={(e) => {
        // Flatten any newline (e.g. from a paste) to a space before it reaches
        // the form's handler, then size to content.
        if (e.target.value.includes("\n")) {
          e.target.value = e.target.value.replace(/\s*\n\s*/g, " ");
        }
        grow(e.currentTarget);
        onChange(e);
      }}
    />
  );
}
