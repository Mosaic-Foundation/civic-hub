import { useState } from "react";
import "./ShareButton.css";

export interface ShareButtonProps {
  title: string;
  url?: string;
  /**
   * Accepted for callers that still pass it, but no longer handed to the
   * native share sheet — see handleNativeShare. The destination page's own
   * link preview carries the topic instead.
   */
  shareText?: string;
}

export default function ShareButton({ title, url }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = url ?? (typeof window !== "undefined" ? window.location.href : "");

  const hasNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

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

  function handleFacebook() {
    const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl)}`;
    window.open(fbUrl, "_blank", "noopener,noreferrer,width=600,height=400");
  }

  // Plain-link channels that work from any browser, phone or desktop.
  // sms: with an empty number opens the Messages composer; mailto: the
  // mail client. Both carry the title and the link, nothing else.
  const smsHref = `sms:?&body=${encodeURIComponent(`${title} ${fullUrl}`)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(
    `${title}\n${fullUrl}`,
  )}`;

  async function handleNativeShare() {
    try {
      // URL only. With `text` AND `url`, Safari / iOS hand the sheet two
      // items and Copy / Messages take the text — the link never travels
      // (Adam: "the copy button doesn't seem to work… sharing via text
      // doesn't seem to work"). The title still heads the sheet; the
      // destination's own link preview (api/og.ts) carries the topic.
      await navigator.share({ title, url: fullUrl });
    } catch {
      // user dismissed
    }
  }

  return (
    <div className="share-row">
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

      <button
        type="button"
        className="share-icon-btn share-icon-btn--facebook"
        onClick={handleFacebook}
        aria-label="Share on Facebook"
        title="Share on Facebook"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </button>

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

      <a
        className="share-icon-btn share-icon-btn--email"
        href={mailHref}
        aria-label="Share by email"
        title="Email"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="3 7 12 13 21 7" />
        </svg>
      </a>

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
    </div>
  );
}
