// The hub's UI kit (engine 2, A7): the controls the hub's own forms draw,
// as components, so a plugin package's pages look like the hub's own. Each
// renders the hub's classes (App.css: btn-*, form-*), so a hub's theme, its
// focus rings and its sizes reach a package page with nothing to copy. A
// package imports them from `@civic-social/plugin-sdk/ui`.
//
// Colour on a filled button is --color-primary-text (text on the primary
// fill), never --color-primary-ink (the darkest primary tone, for text on a
// light tint): reading the second as the first is what drew black text on the
// dark-blue Submit of the Events form and the Activity page's chip
// (theme.css says which is which; tests/unit/buttonInk.test.ts holds it).

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

import { fromLocalInput, toLocalInput } from "./datetime";

export { default as DraftShell } from "../components/DraftShell";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the page's one main action; secondary: the others; danger: what cannot be undone. */
  variant?: "primary" | "secondary" | "danger";
};

/** The hub's button. `type` defaults to "button" (a form's Submit says type="submit"). */
export function Button({ variant = "secondary", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={[`btn-${variant}`, className].filter(Boolean).join(" ")} {...rest} />;
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
 * A date and time, in the reader's time zone, as the hub's form input. Takes
 * and gives an ISO instant (null for none), so a package stores what the
 * server reads. The browser's own picker for now (the design pass may replace
 * it here, for every page at once).
 */
export function DateTimeInput({
  value,
  onChange,
  timeZone,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  /** The IANA zone the time is entered in (an event's own); the reader's when absent. */
  timeZone?: string;
}) {
  return (
    <input
      type="datetime-local"
      className={["form-input", className].filter(Boolean).join(" ")}
      value={toLocalInput(value, timeZone)}
      onChange={(e) => onChange(fromLocalInput(e.target.value, timeZone))}
      {...rest}
    />
  );
}
