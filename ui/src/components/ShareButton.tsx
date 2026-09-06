import { useEffect, useRef, useState } from "react";
import {
  retireShareMoment,
  shareMomentRetired,
  subscribeShareMoments,
  type ShareMoment,
} from "./shareMomentBus";
import "./ShareButton.css";

/** A one-off "consider sharing this" callout pointed at the bar. Passed on
 *  mount for pages that are themselves the moment (a brief, a result), or
 *  announced later by ShareMoment when the person acts on the page. Shown
 *  once per process, for a few seconds, and never has to be dismissed —
 *  Adam (2026-09-04) on the first cut, a card with its own share row: "it
 *  just looks like a redundant share options"; (2026-09-06) on the note
 *  with a ×: "another thing that somebody has to dismiss". */
export interface ShareNudge {
  processId: string;
  text: string;
}

/** How long the callout stays. Long enough to read twice on a phone. */
const CALLOUT_MS = 6000;

export interface ShareButtonProps {
  title: string;
  url?: string;
  /** The process this bar shares. A ShareMoment announced for the same id
   *  shows the callout here. */
  processId?: string;
  /** A callout to show on mount — for pages that are the moment themselves. */
  nudge?: ShareNudge | null;
  /**
   * Accepted for callers that still pass it, but no longer handed to the
   * native share sheet — see handleNativeShare. The destination page's own
   * link preview carries the topic instead.
   */
  shareText?: string;
}

export default function ShareButton({ title, url, nudge, processId }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  // The callout: subscribed by process id for moments announced later (a
  // vote cast, a proposal endorsed), and shown at once for a nudge passed on
  // mount. Either way it is retired the moment it shows, so it is once per
  // process per browser; and if the bar is off screen — the vote page's bar
  // is several screens above the ballot — the bar is brought into view
  // first, because a bubble pointing at nothing is noise.
  const momentId = processId ?? nudge?.processId;
  const nudgeText = nudge?.processId === momentId ? nudge?.text : undefined;
  useEffect(() => {
    if (!momentId) return;
    let observer: IntersectionObserver | undefined;
    const present = (text: string) => {
      retireShareMoment(momentId);
      setCallout(text);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setCallout(null), CALLOUT_MS);
    };
    const show = ({ text, reveal }: ShareMoment) => {
      if (shareMomentRetired(momentId)) return;
      const el = rowRef.current;
      const r = el?.getBoundingClientRect();
      const inView = !!r && r.top >= 0 && r.bottom <= window.innerHeight;
      if (inView || !el) {
        present(text);
        return;
      }
      if (reveal === "when-visible" && typeof IntersectionObserver === "function") {
        // Armed: appears when the bar next comes into view on its own.
        observer?.disconnect();
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              observer?.disconnect();
              present(text);
            }
          },
          { threshold: 0.9 },
        );
        observer.observe(el);
        return;
      }
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      present(text);
    };
    const unsubscribe = subscribeShareMoments(momentId, show);
    if (nudgeText) show({ text: nudgeText, reveal: "scroll" });
    return () => {
      unsubscribe();
      observer?.disconnect();
      window.clearTimeout(hideTimer.current);
    };
  }, [momentId, nudgeText]);

  // The page's canonical address: never the hash. `#edits` opens the change
  // history, and a shared link must land on the plain page (Adam, 2026-09-03).
  const fullUrl =
    url ??
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : "");

  const hasNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  // Can this device actually send a text message? A touch device with no
  // hover — a phone, or a tablet without a trackpad.
  //
  // This gates the sms: button, which is BROKEN on a desktop in a way we
  // cannot fix from a link: macOS opens Messages on the most recent
  // conversation and drops the body into it, so the link is addressed to
  // whoever you last texted (Adam, 2026-09-05: "it goes to my wife every
  // time"). Windows and Linux mostly do nothing at all. There is no URI that
  // asks for a recipient picker — sms: takes a number or nothing — so the
  // honest fix is not to offer the channel where it misfires. Desktop keeps
  // Copy, Facebook, and the OS share sheet.
  const isTouchDevice =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  async function handleCopy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy the link.");
      window.setTimeout(() => setError(null), 4000);
    }
  }

  // A plain link, NOT window.open with width/height: iOS Safari treats a
  // window.open that carries window features as a popup and blocks it
  // silently, which is why Facebook worked on desktop and did nothing on a
  // phone (Adam, 2026-09-04). An anchor is never popup-blocked.
  //
  // DESKTOP ONLY — see the button below, which is not rendered on a phone.
  //
  // `u` is fine; what Facebook removed in 2017 was `quote`, the user's
  // pre-written message. Measured 2026-09-05: the link even survives
  // Facebook's own mobile redirect, carried in `next=`.
  //
  // It is not rendered on a phone because there is no way to make it do
  // anything useful there. `facebook.com` is a universal link, so iOS hands
  // the tap to the Facebook app, which has no route for /sharer/sharer.php
  // and lands on the feed with no draft. (Adam's evidence, not a probe of
  // mine: "a little Chrome text at the top left to go back to Chrome" — the
  // Back-to-Chrome banner only appears once another app has the screen.)
  //
  // Three things were tried and rejected in turn:
  //   - navigator.share() from this button: works, but is then identical to
  //     the Share… button beside it. Adam: "seems to have reverted back to
  //     behave exactly like the other share button."
  //   - window.open() to m.facebook.com, to dodge the universal link two
  //     ways at once (JS-initiated navigation, and a host the app may not
  //     claim): moot once the button is gone from phones.
  //   - asking the OS sheet to surface Facebook first: navigator.share takes
  //     only title/text/url/files. iOS ranks targets by how often that PERSON
  //     shares to them and gives a page no say. The person can reorder it
  //     themselves; we cannot do it for them.
  //
  // So on a phone the labelled Share… button is the route to Facebook — it
  // works, Adam confirmed a real post — and copy-link is the backstop.
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl)}`;

  // Plain-link channel that works from any browser, phone or desktop:
  // sms: with an empty number opens the Messages composer with the title
  // and the link. (An email button was dropped — a mailto: link looks dead
  // on a desktop with no default mail app; people can paste the copied link.)
  const smsHref = `sms:?&body=${encodeURIComponent(`${title} ${fullUrl}`)}`;

  async function handleNativeShare() {
    try {
      // URL only. With `text` AND `url`, Safari / iOS hand the sheet two
      // items and Copy / Messages take the text — the link never travels.
      // The title still heads the sheet; the destination's own link
      // preview (api/og.ts) carries the topic.
      await navigator.share({ title, url: fullUrl });
    } catch {
      // user dismissed
    }
  }

  return (
    <div className="share-row" ref={rowRef}>
      <button
        type="button"
        className="share-icon-btn share-icon-btn--copy"
        onClick={handleCopy}
        aria-label={copied ? "Link copied" : "Copy link"}
        title={copied ? "Link copied!" : "Copy link"}
      >
        {copied ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </button>

      {!isTouchDevice && (
      <a
        className="share-icon-btn share-icon-btn--facebook"
        href={facebookHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        title="Share on Facebook"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>
      )}

      {isTouchDevice && (
      <a
        className="share-icon-btn share-icon-btn--sms"
        href={smsHref}
        aria-label="Share by text message"
        title="Text message"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </a>
      )}

      {/* The phone's own share sheet — the route to Instagram, Snapchat,
          TikTok, Discord, iMessage. Labeled, so it is not mistaken for
          another icon. */}
      {hasNativeShare && (
        <button
          type="button"
          className="share-icon-btn share-icon-btn--more share-btn--labeled"
          onClick={handleNativeShare}
          aria-label="More sharing options"
          title="More sharing options"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          <span className="share-btn-label">Share…</span>
        </button>
      )}

      {error && (
        <span className="share-row-error" role="alert">{error}</span>
      )}

      {/* The callout. Points down at the buttons it is talking about; goes
          away on its own, or on a tap. */}
      {callout && (
        <div
          className="share-callout"
          role="status"
          onClick={() => setCallout(null)}
          title="Dismiss"
        >
          {callout}
        </div>
      )}
    </div>
  );
}
