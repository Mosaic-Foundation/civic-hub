import { useLayoutEffect, useRef } from "react";

/**
 * A single-line value in a box that grows to show all of it — the controlled
 * sibling of TitleField. Built for the approval-vote option rows: a long
 * option used to scroll off the end of an <input> with no way to see or edit
 * the tail on a phone (Adam, 2026-09-05, "the same issue I had with the title
 * before"). It wraps and grows, up to `maxLines`, then scrolls inside the box
 * — options are capped at 200 characters, so a few lines is the most one
 * should ever need, and an unbounded box would push the rest of the list
 * around. Semantically still one line: Enter is blocked and pasted newlines
 * flatten to spaces.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Lines the box may grow to before it scrolls. */
  maxLines?: number;
  "aria-label"?: string;
}

const LINE_HEIGHT = 1.4; // em — must match the CSS line-height below

export default function GrowingLineInput({
  value,
  onChange,
  className,
  placeholder,
  maxLength,
  disabled,
  maxLines = 6,
  ...aria
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Size to content on every value change (typing, an applied suggestion,
  // a resumed draft), capped at maxLines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const fontPx = parseFloat(getComputedStyle(el).fontSize) || 16;
    const padding =
      parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    const maxPx = maxLines * LINE_HEIGHT * fontPx + padding + 2;
    const wanted = el.scrollHeight;
    el.style.height = `${Math.min(wanted, maxPx)}px`;
    el.style.overflowY = wanted > maxPx ? "auto" : "hidden";
  }, [value, maxLines]);

  return (
    <textarea
      ref={ref}
      className={`growing-line-input${className ? ` ${className}` : ""}`}
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      enterKeyHint="done"
      aria-label={aria["aria-label"]}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault(); // one line, semantically
      }}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
    />
  );
}
