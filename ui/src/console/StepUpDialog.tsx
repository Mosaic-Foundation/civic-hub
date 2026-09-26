import { useRef, useState } from "react";
import { api } from "./api";

export default function StepUpDialog({ what, onDone }: { what: string; onDone: (code: string | null) => void }) {
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="cx-overlay" role="presentation">
      <form
        className="cx-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stepup-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{6}$/.test(code.trim())) onDone(code.trim());
        }}
      >
        <h2 id="stepup-title">Confirm with a fresh code</h2>
        <p className="cx-muted">
          {what} needs a second check. A six-digit code is on its way to your email.
        </p>
        <label className="cx-field">
          <span>Code</span>
          <input
            ref={input}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <div className="cx-actions">
          <button type="button" className="cx-btn cx-btn-quiet" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="cx-btn cx-btn-quiet"
            disabled={resent}
            onClick={async () => {
              setResent(true);
              await api.requestStepUp().catch(() => undefined);
              input.current?.focus();
            }}
          >
            {resent ? "Sent again" : "Send again"}
          </button>
          <button type="submit" className="cx-btn cx-btn-primary" disabled={!/^\d{6}$/.test(code)}>
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}
