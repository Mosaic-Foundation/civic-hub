// The kit's switch, in its own file, like Button.

import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * On or off, said at once (a card shown or hidden): a checkbox drawn as a
 * switch, read as one (role="switch"). Hub UI only for now (layout session,
 * 2026-11-07): not in @civic-social/plugin-sdk/ui.
 */
export function Switch({
  label,
  hint,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={["kit-switch", className].filter(Boolean).join(" ")}>
      <input type="checkbox" role="switch" className="kit-switch-input" {...rest} />
      <span className="kit-switch-track" aria-hidden="true">
        <span className="kit-switch-thumb" />
      </span>
      <span className="kit-check-text">
        <span>{label}</span>
        {hint && <span className="kit-check-hint">{hint}</span>}
      </span>
    </label>
  );
}

