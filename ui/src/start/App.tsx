// The start page (session 4b, Adam 2026-10-08): an invite code, an emailed
// sign-in code, a short form, and the person lands on their new hub as its
// admin, signed in. Three steps, each its own card; the server says which
// step the page is on (GET /start/session), so a reload resumes.

import { useCallback, useEffect, useState } from "react";
import { StartApiError, startApi, type RefusedLink, type StartSessionView } from "./api";
import CreateForm from "./CreateForm";
import { codeFromFragment, inviteTokenFromFragment } from "../../../src/shared/hubInvite";

/**
 * The code an invite link carries (#code=…). Read once, as the page loads, and
 * taken out of the address bar, so it stays out of the history and a shared
 * screen.
 */
function takeLinkedCode(): string {
  const code = codeFromFragment(window.location.hash);
  if (code) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return code ?? "";
}
const LINKED_INVITE = inviteTokenFromFragment(window.location.hash);
if (LINKED_INVITE) window.history.replaceState(null, "", window.location.pathname + window.location.search);
const LINKED_CODE = takeLinkedCode();

/**
 * An emailed invite's link, followed once as the page loads: it is spent by the
 * first request, so this is outside React and its double effects. What it
 * resolves to is the refusal to show, or null.
 */
const INVITE_FOLLOWED: Promise<RefusedLink | null> = LINKED_INVITE
  ? startApi.inviteLink(LINKED_INVITE).then(
      () => null,
      (e: Error): RefusedLink => {
        const body = e instanceof StartApiError ? e.body : {};
        return typeof body.link_state === "string"
          ? (body as unknown as RefusedLink)
          : { error: e.message, link_state: "unknown", email: null, hub_url: null };
      },
    )
  : Promise.resolve(null);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="cx-center">
      <div className="cx-card cx-narrow st-card">
        <p className="cx-eyebrow">Civic Social</p>
        <h1 className="cx-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="cx-alert cx-alert-error" role="alert">
      {error}
    </p>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function CodeStep({ refused, onDone }: { refused: boolean; onDone: () => void }) {
  const [code, setCode] = useState(LINKED_CODE);
  const { busy, error, run } = useBusy();
  return (
    <Card title="Start your Civic Hub">
      <p className="cx-muted">
        {LINKED_CODE
          ? "Your invite code is filled in from your link. It lets you create one hub."
          : "Enter the invite code you were given. It lets you create one hub."}
      </p>
      {refused && (
        <p className="cx-alert cx-alert-warn" role="status">
          The code you used earlier can no longer be used. If you have another, enter it here.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await startApi.invite(code);
            onDone();
          });
        }}
      >
        <label className="cx-field">
          <span>Invite code</span>
          <input
            className="cx-mono st-code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
            maxLength={20}
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <button className="cx-btn cx-btn-primary cx-block" disabled={busy || code.trim().length < 12}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
      <ErrorLine error={error} />
    </Card>
  );
}

/**
 * A link from an emailed invite that can't be followed (pilot readiness 3,
 * Adam 2026-11-06): what happened, in plain words, and the one thing to do.
 * While the invite is good, that is "Send me a fresh link", to the same
 * address; once it made a hub, that hub's sign-in.
 */
function LinkRefusedStep({ refusal, token }: { refusal: RefusedLink; token: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  const canRefresh = refusal.link_state === "spent" || refusal.link_state === "expired";
  const title =
    refusal.link_state === "redeemed"
      ? "Your hub is already made"
      : refusal.link_state === "ended" || refusal.link_state === "unknown"
        ? "This invite can't be used"
        : "This link has been used";
  return (
    <Card title={refusal.link_state === "expired" ? "This link has expired" : title}>
      {sentTo ? (
        <p className="cx-alert cx-alert-ok" role="status">
          We sent a fresh link to <strong>{sentTo}</strong>. Open it from that email; it works once, for seven days.
        </p>
      ) : (
        <p className="cx-muted">{refusal.error}</p>
      )}
      {canRefresh && !sentTo && (
        <button
          type="button"
          className="cx-btn cx-btn-primary cx-block"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await startApi.freshLink(token);
              setSentTo(r.sent_to);
            })
          }
        >
          {busy ? "Sending…" : "Send me a fresh link"}
        </button>
      )}
      {refusal.link_state === "redeemed" && refusal.hub_url && (
        <a className="cx-btn cx-btn-primary cx-block" href={refusal.hub_url}>
          Go to your hub's sign-in
        </a>
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

function SignInStep({ onDone, onLeave }: { onDone: () => void; onLeave: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, setError, run } = useBusy();
  return (
    <Card title="Sign in">
      <p className="cx-muted">
        Your code is good. Now your email address: you'll be your hub's first admin, and this is how you'll sign in to it.
      </p>
      {sent === null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await startApi.requestCode(email);
              setSent(r.message);
            });
          }}
        >
          <label className="cx-field">
            <span>Email</span>
            <input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="cx-btn cx-btn-primary cx-block" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await startApi.verify(email, code);
              onDone();
            });
          }}
        >
          <p className="cx-muted">
            {sent} We sent it to <strong>{email}</strong>.
          </p>
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
              setSent(null);
              setCode("");
              setError(null);
            }}
          >
            Use a different address
          </button>
        </form>
      )}
      <ErrorLine error={error} />
      <p className="st-leave">
        <button type="button" className="cx-linkbtn" onClick={onLeave}>
          Start over with a different code
        </button>
      </p>
    </Card>
  );
}

export default function App() {
  const [session, setSession] = useState<StartSessionView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [linkRefused, setLinkRefused] = useState<RefusedLink | null>(null);

  const load = useCallback(() => {
    void INVITE_FOLLOWED.then((refusal) => {
      setLinkRefused(refusal);
      return startApi.session();
    })
      .then((s) => {
        setSession(s);
        setFailed(null);
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);

  useEffect(load, [load]);

  const leave = useCallback(() => {
    void startApi.leave().catch(() => undefined).then(load);
  }, [load]);

  if (failed) {
    return (
      <Card title="Start a Civic Hub">
        <p className="cx-muted">{failed}</p>
      </Card>
    );
  }
  if (!session) return <main className="cx-center cx-muted">Loading…</main>;
  // A second click on a link this browser already followed: the form is still theirs.
  if (linkRefused && LINKED_INVITE && session.step !== "form") return <LinkRefusedStep refusal={linkRefused} token={LINKED_INVITE} />;
  if (session.step === "code") return <CodeStep refused={session.code_refused} onDone={load} />;
  if (session.step === "sign_in") return <SignInStep onDone={load} onLeave={leave} />;
  return <CreateForm email={session.email ?? ""} onSessionEnded={load} onLeave={leave} />;
}
