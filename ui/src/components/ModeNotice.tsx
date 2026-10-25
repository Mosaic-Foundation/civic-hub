// The hub's mode notice, as a one-time message (navigation polish, Adam,
// 2026-10-14): the full beta or demo message with a close control; closed,
// it becomes a thin bar that still says which mode the hub is in ("Beta
// hub", "Demo hub") and keeps its button on the right (Join the waitlist,
// Remove samples). Tapping the short label opens the full message again.
//
// Closed is remembered in this browser per mode, in localStorage: a hub that
// moves from demo to beta shows its new message in full. A live hub shows no
// notice, so it forgets what was closed (forgetClosedNoticeOnLive): a hub that
// goes back from live to beta shows the beta message in full again
// (leaving-demo slice, 2026-10-15). Storage can be
// blocked (a private window, a site setting); then the full message shows, as
// it always did.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHub } from "../config/hub";
import { readClosed, writeClosed } from "./modeNoticeState";
import "./BetaBanner.css";

export default function ModeNotice({
  label,
  short,
  message,
  action,
  className,
}: {
  /** Names the region for a screen reader: "Beta notice". */
  label: string;
  /** The thin bar's words: "Beta hub". */
  short: string;
  /** The full message. */
  message: ReactNode;
  /** The button on the right, in both forms (or nothing). */
  action?: ReactNode;
  className?: string;
}) {
  const hub = useHub();
  const mode = hub.config?.hub.mode ?? "unknown";
  const [closed, setClosed] = useState(() => readClosed() === mode);
  // The control a person pressed goes away with the form it was in; the
  // keyboard lands on the one that undoes it.
  const toggled = useRef(false);
  const shortRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (closed ? shortRef : closeRef).current?.focus();
  }, [closed]);

  function close() {
    writeClosed(mode);
    toggled.current = true;
    setClosed(true);
  }

  function open() {
    writeClosed(null);
    toggled.current = true;
    setClosed(false);
  }

  if (closed) {
    return (
      <div
        className={`beta-banner beta-banner--thin${className ? ` ${className}` : ""}`}
        role="region"
        aria-label={label}
        data-testid="mode-notice"
        data-state="thin"
      >
        <button ref={shortRef} type="button" className="beta-banner-short" onClick={open} aria-expanded={false}>
          {short}
          <span className="visually-hidden">: show the full notice</span>
        </button>
        {action}
      </div>
    );
  }

  return (
    <div
      className={`beta-banner${className ? ` ${className}` : ""}`}
      role="region"
      aria-label={label}
      data-testid="mode-notice"
      data-state="full"
    >
      <span className="beta-banner-text">{message}</span>
      {action}
      <button ref={closeRef} type="button" className="beta-banner-close" onClick={close} aria-label={`Close the ${label.toLowerCase()}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
