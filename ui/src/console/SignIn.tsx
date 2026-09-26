import { useState } from "react";
import { api } from "./api";

export default function SignIn({ configured, onSignedIn }: { configured: boolean; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cx-center">
      <div className="cx-card cx-narrow">
        <p className="cx-eyebrow">Civic Social</p>
        <h1 className="cx-title">Console</h1>
        {!configured && (
          <p className="cx-alert cx-alert-warn" role="alert">
            No operator is configured on this deployment (CIVIC_CONSOLE_ADMIN_EMAIL). Nobody can sign in.
          </p>
        )}
        {step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await api.requestCode(email);
                setNote(r.message);
                setStep("code");
              });
            }}
          >
            <label className="cx-field">
              <span>Email</span>
              <input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="cx-btn cx-btn-primary cx-block" disabled={busy || !configured}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.verify(email, code);
                onSignedIn();
              });
            }}
          >
            {note && <p className="cx-muted">{note}</p>}
            <label className="cx-field">
              <span>Six-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <button className="cx-btn cx-btn-primary cx-block" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              className="cx-btn cx-btn-quiet cx-block"
              onClick={() => {
                setStep("email");
                setCode("");
              }}
            >
              Use a different address
            </button>
          </form>
        )}
        {error && (
          <p className="cx-alert cx-alert-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
