// The line beside "Create my hub" (sign-in slice, Adam 2026-10-13): the
// creator agrees to the Code of Conduct, Privacy Notice and Terms once, here,
// and is not asked again as a member of the hub. The hub doesn't exist yet,
// so each name opens its plain-language summary in place; the full documents
// are on the hub once it is made.

import { useState, type ReactElement } from "react";
import { startApi, type LegalSummary } from "./api";

/** The summaries are a few lines of lists and bold labels; nothing else. */
function Summary({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
  const blocks: ReactElement[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) blocks.push(<ul key={blocks.length}>{items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>);
    items = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) items.push(line.slice(2));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="st-terms-summary">{blocks}</div>;
}

export function TermsAtCreate({ kind, place }: { kind: string; place: string }) {
  const [summaries, setSummaries] = useState<LegalSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle(title: string) {
    if (open === title) return setOpen(null);
    setOpen(title);
    try {
      setSummaries((await startApi.legal(kind, place)).summaries);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const name = (title: string) => (
    <button type="button" className="cx-linkbtn st-terms-link" aria-expanded={open === title} onClick={() => toggle(title)}>
      {title}
    </button>
  );
  const shown = summaries?.find((s) => s.title === open);
  return (
    <div className="st-terms">
      <p className="st-terms-notice">
        By creating your hub you agree to the {name("Code of Conduct")}, {name("Privacy Notice")} and {name("Terms")}.
      </p>
      {open && (
        <div className="st-terms-panel" role="region" aria-label={`${open}, in short`}>
          <p className="st-terms-heading">{open}, in short</p>
          {shown ? <Summary text={shown.summary} /> : failed ? <p>This couldn't load. Try again in a moment.</p> : <p>Loading…</p>}
          <p className="st-terms-after">The full documents are on your hub once it's created, linked at the bottom of every page.</p>
        </div>
      )}
    </div>
  );
}
