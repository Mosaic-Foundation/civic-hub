import { useEffect, useId, useRef, useState } from "react";
import { useHub } from "../config/hub";
import { mastodonServerFrom, mastodonShareUrl } from "./mastodonShareUrl";

/**
 * Share on Mastodon (the fediverse plan, 2026-11-12, item 1). Mastodon has no
 * one website to share to: each person is on their own server. So the first
 * tap asks which server ("mastodon.social", or their whole handle), remembers
 * it in this browser, and opens that server's own compose page with the title
 * and the link filled in (`https://<server>/share?text=…`, which Mastodon has
 * answered since 2017). Later taps go straight there, with a "Change server"
 * link beside the bar for a few seconds.
 *
 * Shown only on hubs that switched the Fediverse feature on.
 */

const STORAGE_KEY = "civic.mastodon_server";
/** How long "Opened on … · Change server" stays. */
const NOTE_MS = 6000;

function rememberedServer(): string | null {
  try {
    return mastodonServerFrom(window.localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

function remember(server: string | null) {
  try {
    if (server) window.localStorage.setItem(STORAGE_KEY, server);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing: it just asks again next time.
  }
}

export default function MastodonShare({ title, url }: { title: string; url: string }) {
  const hub = useHub();
  const inputId = useId();
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  useEffect(() => {
    if (asking) inputRef.current?.focus();
  }, [asking]);

  if (!hub.plugins.enabled("fediverse")) return null;

  const text = `${title} ${url}`;

  function open(server: string) {
    // No window features: iOS Safari blocks a window.open that has them.
    window.open(mastodonShareUrl(server, text), "_blank", "noopener");
    setOpenedOn(server);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setOpenedOn(null), NOTE_MS);
  }

  function onButton() {
    const server = rememberedServer();
    if (server) open(server);
    else {
      setOpenedOn(null);
      setAsking((a) => !a);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const server = mastodonServerFrom(value);
    if (!server) {
      setError("That doesn't look like a server address. Try something like mastodon.social.");
      return;
    }
    remember(server);
    setAsking(false);
    setError(null);
    open(server);
  }

  return (
    <>
      <button
        type="button"
        className="share-icon-btn share-icon-btn--mastodon"
        onClick={onButton}
        aria-label="Share on Mastodon"
        title="Share on Mastodon"
        aria-expanded={asking}
        data-testid="share-mastodon"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M21.3 7.6c0-3.6-2.4-4.7-2.4-4.7C17.7 2.4 15.6 2.1 12 2.1h-.1c-3.6 0-5.7.3-6.9.8 0 0-2.4 1.1-2.4 4.7 0 4.2-.1 9.4 3.9 10.5 1.6.4 3 .5 4.1.5 2-.1 3.2-.7 3.2-.7l-.1-1.6s-1.4.4-3 .4c-1.6-.1-3.3-.2-3.6-2.1v-.5s1.6.4 3.6.5c1.3.1 2.5-.1 3.6-.2 2.3-.3 4.3-1.7 4.5-3 .4-2.1.5-3.8.5-3.8z"
          />
          <path
            d="M7.6 12.6V9.3c0-.9.5-1.5 1.4-1.5s1.4.6 1.4 1.5v1.6M10.4 10.9V9.3c0-.9.5-1.5 1.4-1.5s1.4.6 1.4 1.5v3.3"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {asking && (
        <form className="mastodon-ask" onSubmit={onSubmit} data-testid="share-mastodon-ask">
          <label htmlFor={inputId} className="mastodon-ask-label">
            Your Mastodon server
          </label>
          <div className="mastodon-ask-row">
            <input
              ref={inputRef}
              id={inputId}
              className="mastodon-ask-input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="mastodon.social"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
            />
            <button type="submit" className="mastodon-ask-go">
              Post
            </button>
          </div>
          <p className="mastodon-ask-hint">
            {error ?? "Where your account is, or your whole handle. Remembered in this browser."}
          </p>
        </form>
      )}

      {openedOn && !asking && (
        <span className="mastodon-opened" role="status">
          Opened on {openedOn}.{" "}
          <button
            type="button"
            className="mastodon-change"
            onClick={() => {
              remember(null);
              setOpenedOn(null);
              setValue("");
              setAsking(true);
            }}
          >
            Change server
          </button>
        </span>
      )}
    </>
  );
}
