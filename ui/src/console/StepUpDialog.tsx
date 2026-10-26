import { useRef, useState } from "react";
import Modal from "../components/Modal";
import { api } from "./api";

export default function StepUpDialog({
  what,
  notice: firstNotice = null,
  onDone,
}: {
  what: string;
  /** Why no code was sent, in the server's words (a limit, a code still waiting); null when one is on its way. */
  notice?: string | null;
  onDone: (code: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [notice, setNotice] = useState<string | null>(firstNotice);
  const input = useRef<HTMLInputElement>(null);

  // Escape closes it as Cancel does; the × is left out (Cancel is there) and
  // so is the backdrop click, as before.
  return (
    <Modal
      title="Confirm with a fresh code"
      titleClassName="cx-dialog-title"
      className="cx-dialog"
      bodyClassName="cx-dialog-body"
      onClose={() => onDone(null)}
      closeOnBackdrop={false}
      showClose={false}
      initialFocus={input}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{6}$/.test(code.trim())) onDone(code.trim());
        }}
      >
        <p className="cx-muted">
          {what} needs a second check.{notice ? "" : " A six-digit code is on its way to your email."}
        </p>
        {notice && (
          <p className="cx-alert cx-alert-error" role="alert" data-testid="step-up-notice">
            {notice}
          </p>
        )}
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
              setNotice(
                await api.requestStepUp().then(
                  () => null,
                  (e: unknown) => (e instanceof Error ? e.message : String(e)),
                ),
              );
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
    </Modal>
  );
}
