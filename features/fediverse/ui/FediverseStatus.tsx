// The Fediverse panel's status line on the Plugins page: the hub's handle,
// which people search for in Mastodon, and how many accounts follow it.

import { useEffect, useState } from "react";
import { useApi } from "../../../ui/src/hooks/useApi";
import { request } from "../../../ui/src/services/http";
import "./fediverse.css";

interface Status {
  handle: string;
  actor_url: string;
  followers: number;
  posts: number;
  ready: boolean;
}

export default function FediverseStatus({ on }: { on: boolean }) {
  const status = useApi(on ? "fediverse/status" : null, () => request<Status>("GET", "/admin/fediverse"));
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  // The count changes while the page is open (someone follows from their
  // phone): read it again whenever the admin comes back to this tab.
  const { reload } = status;
  useEffect(() => {
    if (!on) return;
    const again = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [on, reload]);
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
  async function postNow() {
    setRunning(true);
    setRan(null);
    try {
      const r = await request<{ posted: number; delivered: number; failed: number; gave_up: number }>("POST", "/admin/fediverse/run");
      const posts = r.posted === 1 ? "1 new post" : `${r.posted} new posts`;
      const sent = r.delivered === 1 ? "1 delivery" : `${r.delivered} deliveries`;
      const retry = r.failed > 0 ? `, ${r.failed} to try again` : "";
      setRan(`Done: ${posts}, ${sent}${retry}.`);
      void status.reload();
    } catch (err) {
      setRan(err instanceof Error ? err.message : "It couldn't run just now.");
    } finally {
      setRunning(false);
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
        {s.followers === 1 ? "1 account follows it" : `${s.followers.toLocaleString()} accounts follow it`}, and it has
        made {s.posts === 1 ? "1 post" : `${s.posts.toLocaleString()} posts`}. It posts what opens and what is decided,
        starting from when it was switched on.
      </p>
      <p>
        <button type="button" className="btn-secondary btn-sm" onClick={postNow} disabled={running} data-testid="fediverse-post-now">
          {running ? "Posting…" : "Post now"}
        </button>{" "}
        <span className="form-hint" role="status">
          {ran ?? "Posts and delivers anything waiting now, instead of at the next ten-minute run."}
        </span>
      </p>
    </div>
  );
}
