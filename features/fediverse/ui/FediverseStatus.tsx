// The Fediverse panel's status line on the Plugins page: the hub's handle,
// which people search for in Mastodon, and how many accounts follow it.

import { useState } from "react";
import { useApi } from "../../../ui/src/hooks/useApi";
import { request } from "../../../ui/src/services/http";
import "./fediverse.css";

interface Status {
  handle: string;
  actor_url: string;
  followers: number;
  ready: boolean;
}

export default function FediverseStatus({ on }: { on: boolean }) {
  const status = useApi(on ? "fediverse/status" : null, () => request<Status>("GET", "/admin/fediverse"));
  const [copied, setCopied] = useState(false);
  if (!on) return <p className="form-hint">Once it's on and saved, this shows the hub's handle and how many follow it.</p>;
  if (status.error) return <p className="form-hint">Save to switch it on; the handle shows here after.</p>;
  if (!status.data) return null;
  const s = status.data;
  if (!s.ready) {
    return (
      <p className="form-error" role="status">
        Not answering yet: this deployment has no CIVIC_FEDIVERSE_SECRET, which it needs to sign the hub's posts.
      </p>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(s.handle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // The handle is on screen to copy by hand.
    }
  }
  return (
    <div className="fediverse-status" data-testid="fediverse-status">
      <p>
        People find this hub in Mastodon by searching for <strong>{s.handle}</strong>{" "}
        <button type="button" className="fediverse-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>
      <p className="form-hint">
        {s.followers === 1 ? "1 account follows it." : `${s.followers.toLocaleString()} accounts follow it.`} Nothing is
        posted yet: posts of what opens and what is decided come next.
      </p>
    </div>
  );
}
