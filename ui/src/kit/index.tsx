// The hub's UI kit (engine 2, A7; design pass, 2026-10-29): the controls and
// surfaces the hub's own pages draw, as components, so a plugin package's
// pages look like the hub's own. Each renders the kit's classes (kit.css),
// which read the hub's tokens only, so a hub's theme, a look, dark mode, its
// focus rings and its sizes reach a package page with nothing to copy. A
// package imports them from `@civic-social/plugin-sdk/ui` and sets no colour,
// font or spacing of its own (docs/PLUGIN-STYLE.md; conformance step 21).
//
// Colour on a filled button is --color-primary-text (text on the primary
// fill), never --color-primary-ink (the darkest primary tone, for text on a
// light tint): reading the second as the first is what drew black text on the
// dark-blue Submit of the Events form and the Activity page's chip
// (theme.css says which is which; tests/unit/buttonInk.test.ts holds it).

import { useId, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";


export { default as DraftShell } from "../components/DraftShell";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * primary: the page's one main action; secondary: the others; accent: an
   * invitation to take part ("Raise something", "Going"); ghost: a quiet
   * action in a row; danger: what cannot be undone.
   */
  variant?: "primary" | "secondary" | "accent" | "ghost" | "danger";
  size?: "md" | "sm";
};

/** The hub's button. `type` defaults to "button" (a form's Submit says type="submit"). */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(`btn-${variant}`, size === "sm" && "btn-sm", className)}
      {...rest}
    />
  );
}

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/** One labelled control: the label (with "required" or "optional"), the control, a hint under it. */
export function Field({
  label,
  hint,
  required,
  optional,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <label className="form-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="required" aria-hidden="true">
            {" "}*
          </span>
        )}
        {optional && <span className="optional"> (optional)</span>}
      </label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

/** A one-line text input. */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={["form-input", className].filter(Boolean).join(" ")} {...rest} />;
}

/** A multi-line text input. */
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={["form-textarea", className].filter(Boolean).join(" ")} {...rest} />;
}

/** A choice from a list. */
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={["form-select", className].filter(Boolean).join(" ")} {...rest} />;
}

/**
 * A date and time, in the reader's time zone (or the one named), as the hub's
 * form input: the field and the hub's own picker (kit/DateTimeInput.tsx).
 * Takes and gives an ISO instant (null for none), so a package stores what
 * the server reads.
 */
export { default as DateTimeInput } from "./DateTimeInput";

/** A checkbox with its words, and a line under them when it needs one. */
export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx("kit-check", className)}>
      <input type="checkbox" {...rest} />
      <span className="kit-check-text">
        <span>{label}</span>
        {hint && <span className="kit-check-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** One choice from a few, each a card with a line about it. */
export function RadioCards<T extends string>({
  name,
  value,
  onChange,
  options,
  label,
}: {
  name: string;
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; title: ReactNode; body?: ReactNode; disabled?: boolean }>;
  /** Names the group for a screen reader. */
  label: string;
}) {
  return (
    <div className="kit-choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className="kit-choice">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="kit-check-text">
            <span className="kit-choice-title">{o.title}</span>
            {o.body && <span className="kit-choice-body">{o.body}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * A segmented choice: a period, a filter, a state. One is on; each is a
 * button with aria-pressed. With `onToggle` instead of `onChange` the chosen
 * one can be pressed again to clear it (Events' RSVP: "Going" ticked, the
 * other choice beside it).
 */
export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <div className={cx("kit-chips", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx("kit-chip", value === o.value && "is-on")}
          aria-pressed={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A surface that holds one thing: white on the page, the look's edge or shadow. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("kit-card", className)} {...rest} />;
}

/** A number and what it counts. */
export function Stat({
  value,
  label,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "children"> & { value: ReactNode; label: ReactNode }) {
  return (
    <li className={cx("kit-card kit-stat", className)} {...rest}>
      <span className="kit-stat-n">{value}</span>
      <span className="kit-stat-label">{label}</span>
    </li>
  );
}

/** A row of stats. */
export function StatGrid({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cx("kit-stats", className)} {...rest} />;
}

/** A table on a card: the look's head, rules, hover and stripes. */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="kit-table-wrap">
      <table className={cx("kit-table", className)} {...rest} />
    </div>
  );
}

/** A page's title, and the line under it. */
export function PageHead({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="kit-page-head">
      <h1 className="kit-page-title">{title}</h1>
      {lede && <p className="kit-page-lede">{lede}</p>}
      {children}
    </header>
  );
}

/**
 * A picture chosen from the reader's device: a drop area with a button, the
 * chosen picture shown, Remove beside it. Gives the File (or null); the page
 * uploads it.
 */
export function ImageUpload({
  value,
  onChange,
  label = "Choose a picture",
  accept = "image/jpeg,image/png,image/webp",
  disabled,
}: {
  /** The picture's address to show (a stored URL or an object URL). */
  value: string | null | undefined;
  onChange: (file: File | null) => void;
  label?: string;
  accept?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [over, setOver] = useState(false);
  return (
    <div
      className={cx("kit-upload", over && "is-over", value && "has-image")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onChange(file);
      }}
    >
      {value ? <img className="kit-upload-preview" src={value} alt="" /> : null}
      <div className="kit-upload-actions">
        <input
          ref={input}
          id={id}
          type="file"
          accept={accept}
          className="kit-upload-input"
          // The button below is the keyboard's way in; one tab stop, not two.
          tabIndex={-1}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
          {value ? "Replace" : label}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
        {!value && <span className="kit-upload-hint">or drop it here</span>}
      </div>
    </div>
  );
}
