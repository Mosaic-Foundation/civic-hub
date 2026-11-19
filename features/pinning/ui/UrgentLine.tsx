// The urgent line (Adam, 2026-11-15; an urgent pin since kernel step 4,
// 2026-11-19): the first urgent pin on the Pinned card, as one red line
// across the top of the space's pages, on every layout and width (the right
// column is not drawn on a phone). It links to the item; closing it hides
// that one for this browser, and another urgent one shows again. It shares
// the card's one read (./api.ts) and draws nothing while there is none.

import { Link } from "react-router-dom";
import { useState } from "react";
import { useBoard } from "./PinnedCard";
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
  const urgent = useBoard()?.urgent ?? null;
  const [closed, setClosed] = useState<string | null>(closedId);

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
    <div className="urgent-line" role="region" aria-label="Urgent">
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
