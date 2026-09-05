// A one-line reminder that the page can be shared, offered once per process
// after the person has actually committed to it — voted, endorsed, supported,
// taken part in a conversation.
//
// Adam (2026-09-04): "I want to incentivize more sharing… but I don't want to
// overdo it… as low pressure as possible, allow them to easily dismiss it —
// we're just reminding them that they can share it, that's it."
//
// So: not a modal, not a toast, no second ask. It sits inline where the
// confirmation already is, and one tap on the × retires it for that process
// for good. Using any share channel retires it too — they clearly got the
// message — but leaves the row on screen so the "Copied!" feedback still
// lands.
//
// The marker is per process and per browser (localStorage). Storage being
// unavailable costs the person nothing: the row simply shows and can still
// be dismissed for the session.

import { useState } from "react";
import ShareButton from "./ShareButton";
import "./SharePrompt.css";

const KEY_PREFIX = "civic:share-prompt:";

interface Props {
  /** The process this prompt belongs to — the unit "once per process" counts. */
  processId: string;
  /** Title handed to the share channels. */
  title: string;
  /** Overrides the default line where a type has something better to say. */
  line?: string;
  /** The page to share. Defaults to the current one — pass it explicitly when
   *  the prompt is NOT on the process's own page (My Submissions). */
  url?: string;
}

function alreadyRetired(processId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + processId) === "1";
  } catch {
    return false;
  }
}

export default function SharePrompt({ processId, title, line, url }: Props) {
  // Derived, not frozen at mount — the same mistake ShareButton carried until
  // 2026-09-05, where a value computed once in useState's initializer could
  // never react to a prop arriving later. Harmless while the parent mounts
  // this only at the moment it should appear, but it costs nothing to be
  // correct and it stops the bug reappearing by copy-paste.
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed === processId || alreadyRetired(processId)) return null;

  const retire = () => {
    try {
      localStorage.setItem(KEY_PREFIX + processId, "1");
    } catch {
      /* best effort — the × still works for this view */
    }
  };

  return (
    <div className="share-prompt">
      <div className="share-prompt-head">
        <p className="share-prompt-line">
          {line ?? "Share this so more neighbors can weigh in."}
        </p>
        <button
          type="button"
          className="share-prompt-dismiss"
          onClick={() => {
            retire();
            setDismissed(processId);
          }}
          aria-label="Dismiss this reminder"
        >
          &times;
        </button>
      </div>
      {/* Capture, not bubble: retire on the way down so it is recorded even if
          a channel handler stops propagation. */}
      <div className="share-prompt-actions" onClickCapture={retire}>
        <ShareButton title={title} url={url} />
      </div>
    </div>
  );
}
