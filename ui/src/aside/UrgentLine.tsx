// The urgent line (Adam, 2026-11-15; a plugin's urgent row on the Pinned card, src/services/aside.ts): the
// newest announcement marked urgent, as one red line across the top of the
// hub's pages, on every layout and width (the right column is not drawn on
// a phone). It links to the announcement; closing it hides that one for this
// browser, and a newer urgent one shows again. It shares the right column's
// one read (asideFacts.ts) and draws nothing while there is none.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AsideAnnouncement } from "../services/api";
import { loadAsideFacts, onAsideChanged } from "./asideFacts";
import "./UrgentLine.css";

const CLOSED_KEY = "civic.urgent_line_closed";

function closedId(): string | null {
  try {
    return window.localStorage.getItem(CLOSED_KEY);
  } catch {
    return null;
  }
}

export default function UrgentLine() {
  const [urgent, setUrgent] = useState<AsideAnnouncement | null>(null);
  const [closed, setClosed] = useState<string | null>(closedId);
  useEffect(() => {
    let live = true;
    const read = () =>
      void loadAsideFacts().then((facts) => {
        if (live) setUrgent(facts?.urgent ?? null);
      });
    read();
    const off = onAsideChanged(read);
    return () => {
      live = false;
      off();
    };
  }, []);

  if (!urgent || closed === urgent.process_id) return null;
  const close = () => {
    try {
      window.localStorage.setItem(CLOSED_KEY, urgent.process_id);
    } catch {
      // Private mode: closed for this page only.
    }
    setClosed(urgent.process_id);
  };
  return (
    <div className="urgent-line" role="region" aria-label="Urgent announcement">
      <span className="urgent-line-label">Urgent</span>
      <Link to={urgent.url} className="urgent-line-link">
        {urgent.title}
      </Link>
      <button type="button" className="urgent-line-close" onClick={close} aria-label="Close the urgent notice">
        ×
      </button>
    </div>
  );
}
