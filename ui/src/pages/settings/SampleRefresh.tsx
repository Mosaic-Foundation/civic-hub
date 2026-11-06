// "Refresh samples" in Settings → Sample content (2026-11-05): the console's
// button, for a demo or beta hub's own admin. Samples near their deadline are
// replaced with a fresh copy (what people added to them goes too), and any
// sample the hub lacks is added, except the ones its admins deleted. No code;
// each press is in Settings → Admin log. The server says whether it is
// offered (`summary.refresh.available`): never on a live hub, nor once the
// samples were all removed.
//
// Beside it, "Keep sample content fresh automatically" (`samples.auto_refresh`,
// 2026-11-05): on by default; off stops the daily job on this hub, and the
// button still works. Saved as it is ticked, and in the admin log.

import { useState } from "react";
import { useAction } from "../../hooks/useAction";
import { refreshHubConfig } from "../../config/hubConfig";
import { forgetSampleIds } from "../../components/deletableSample";
import {
  adminRefreshSamples,
  adminSetAutoRefresh,
  type SampleContentSummary,
  type SampleRefreshResult,
} from "../../services/api";

/** What a press changed, in a sentence, by the samples' titles. */
function refreshSentence(r: SampleRefreshResult): string {
  const { refresh, titles } = r;
  const named = (keys: string[]) => keys.map((k) => (titles[k] ? `“${titles[k]}”` : k)).join(", ");
  const parts = [
    refresh.replaced.length ? `Replaced with a fresh copy: ${named(refresh.replaced.map((x) => x.key))}.` : "",
    refresh.added.length ? `Added: ${named(refresh.added)}.` : "",
    refresh.minutes_added.length ? `Minutes added to: ${named(refresh.minutes_added)}.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "Every sample is current; nothing changed.";
}

export default function SampleRefresh({
  auto,
  onRefreshed,
}: {
  /** "Keep sample content fresh automatically", as stored. */
  auto: boolean;
  onRefreshed: (summary: SampleContentSummary) => void;
}) {
  const action = useAction("Could not refresh the samples");
  const autoAction = useAction("Could not save that");
  const [done, setDone] = useState<string | null>(null);

  async function setAuto(on: boolean) {
    setDone(null);
    const result = await autoAction.run(() => adminSetAutoRefresh(on));
    if (result) onRefreshed(result.summary);
  }

  async function refresh() {
    setDone(null);
    const result = await action.run(() => adminRefreshSamples());
    if (!result) return;
    forgetSampleIds();
    // The demo and beta bars speak of samples only while some are left.
    void refreshHubConfig();
    setDone(refreshSentence(result));
    onRefreshed(result.summary);
  }

  return (
    <div className="sample-refresh">
      <p className="form-hint">
        Samples that close within three days (the open vote, the vote gathering endorsements, the open proposal, the
        conversation) are replaced with a fresh copy, along with anything people added to them. Refresh now does the
        same, and adds any sample this hub doesn’t have yet, except the ones you deleted.
      </p>
      <label className="mode-readiness-accept">
        <input
          type="checkbox"
          checked={auto}
          disabled={autoAction.busy}
          onChange={(e) => void setAuto(e.target.checked)}
        />
        Keep sample content fresh automatically (every day)
      </label>
      {autoAction.error && (
        <p className="form-error" role="alert">
          {autoAction.error}
        </p>
      )}
      <div className="admin-settings-actions">
        <button type="button" className="admin-convert-button" onClick={() => void refresh()} disabled={action.busy}>
          {action.busy ? "Refreshing…" : "Refresh samples"}
        </button>
        {done && (
          <span className="admin-settings-message" role="status">
            {done}
          </span>
        )}
        {action.error && (
          <span className="form-error" role="alert">
            {action.error}
          </span>
        )}
      </div>
    </div>
  );
}
