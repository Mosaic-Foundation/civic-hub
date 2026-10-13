// The share banner (2026-10-13): one for the whole hub, mounted once in the
// app shell. A process page announces a share moment from its own
// engagement action (a vote, an endorsement, backing a project); when that
// page's share bar is off screen, the bar hands the moment here
// (shareMomentBus.showShareBanner) instead of scrolling to it. It sits at the
// bottom of the screen for 5 seconds, carries its own Share, and never
// moves the page (Adam: voting used to jump the page to the top, away from
// the results and the receipt).

import { useEffect, useRef, useState } from "react";
import { subscribeShareBanner, type ShareBannerRequest } from "./shareMomentBus";
import "./ShareBanner.css";

/** How long the banner stays. */
export const SHARE_BANNER_MS = 5000;

export default function ShareBanner() {
  const [shown, setShown] = useState<ShareBannerRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = subscribeShareBanner((req) => {
      setCopied(false);
      setShown(req);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShown(null), SHARE_BANNER_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!shown) return null;

  async function share(req: ShareBannerRequest) {
    // The OS sheet where there is one (phones); the link copied elsewhere.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: req.title, url: req.url });
      } catch {
        // dismissed
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(req.url);
      setCopied(true);
    } catch {
      // nothing to do: the bar's own Copy link is still on the page
    }
  }

  return (
    <div className="share-banner" role="status" aria-live="polite">
      <span className="share-banner-text">{shown.text}</span>
      <button type="button" className="share-banner-btn" onClick={() => share(shown)}>
        {copied ? "Link copied" : "Share"}
      </button>
      <button
        type="button"
        className="share-banner-close"
        onClick={() => setShown(null)}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
