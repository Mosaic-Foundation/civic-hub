// The kit's button, in its own file: the kit's index brings every package's UI
// (DraftShell), and code on the first page load imports this alone.

import type { ButtonHTMLAttributes, Ref } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * primary: the page's one main action; secondary: the others; accent: an
   * invitation to take part ("Raise something", "Going"); ghost: a quiet
   * action in a row; danger: what cannot be undone.
   */
  variant?: "primary" | "secondary" | "accent" | "ghost" | "danger";
  size?: "md" | "sm";
  ref?: Ref<HTMLButtonElement>;
};

/** The hub's button. `type` defaults to "button" (a form's Submit says type="submit"). */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[`btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
