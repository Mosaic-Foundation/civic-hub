import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getProcessLinks,
  getPublicBrief,
  type PublicBrief,
  type RenderedLink,
} from "../services/api";
import { friendlyType } from "./ProcessLinkPicker";
import { absoluteTime } from "./FeedPost";
import "./BriefPointer.css";

/**
 * The brief ↔ source pairing, surfaced where a reader actually looks.
 *
 * Adam (smoke test): a completed conversation and its brief were linked
 * only inside the "Related" panel at the bottom of each page — easy to
 * miss. These two pointers put the pair at the TOP: the source process
 * gets an obvious "Read the brief" button, and the brief opens by naming
 * and linking the process it summarizes.
 *
 * UNIVERSAL. Both read the synthetic brief pair the links API derives from
 * the brief's `state.source_process_id` (see services/processLinks.ts
 * getBriefLinks), so they render nothing where there is no brief and
 * appear on their own for any process type that produces one — the four
 * today, and any type added later that declares `generateBrief`. Nothing
 * here asks what kind of process it is on.
 */

const BRIEF_OF_PREFIX = "synthetic:brief-of:";
const BRIEF_SOURCE_PREFIX = "synthetic:brief-source:";

function useBriefPair(processId: string): {
  brief: RenderedLink | null;
  source: RenderedLink | null;
  loaded: boolean;
} {
  const [brief, setBrief] = useState<RenderedLink | null>(null);
  const [source, setSource] = useState<RenderedLink | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getProcessLinks(processId)
      .then((links) => {
        if (cancelled) return;
        setBrief(links.incoming.find((l) => l.id.startsWith(BRIEF_OF_PREFIX)) ?? null);
        setSource(links.outgoing.find((l) => l.id.startsWith(BRIEF_SOURCE_PREFIX)) ?? null);
      })
      .catch(() => {
        // A failed link read must never take the page down — the pointer
        // is a convenience on top of the record, not the record.
        if (cancelled) return;
        setBrief(null);
        setSource(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [processId]);

  return { brief, source, loaded };
}

/** "A" / "A and B" / "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function deliveryLine(brief: PublicBrief): string {
  if (brief.sent_to.length > 0 && brief.delivered_at) {
    return `Sent to ${joinNames(brief.sent_to)} on ${absoluteTime(brief.delivered_at)}.`;
  }
  if (brief.delivered_recipient_count > 0) {
    return "Sent to the governing body.";
  }
  return `Published ${absoluteTime(brief.published_at)}.`;
}

/**
 * On a process page: "This {type} is complete — its final brief is
 * published. Sent to … on …  [Read the brief →]". Renders nothing until
 * a brief exists for this process.
 */
export function BriefPointer({ processId }: { processId: string }) {
  const { brief } = useBriefPair(processId);
  const [detail, setDetail] = useState<PublicBrief | null>(null);

  const briefId = brief?.peer.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (!briefId) return;
    getPublicBrief(briefId)
      .then((b) => {
        if (!cancelled) setDetail(b);
      })
      .catch(() => {
        // The button still works without the receipt line.
      });
    return () => {
      cancelled = true;
    };
  }, [briefId]);

  if (!brief) return null;

  return (
    <aside className="brief-pointer" aria-label="Final brief">
      <div className="brief-pointer-text">
        <strong>The final brief is published.</strong>
        {detail && <span className="brief-pointer-sub"> {deliveryLine(detail)}</span>}
      </div>
      <Link to={brief.peer.href} className="brief-pointer-button">
        Read the brief &rarr;
      </Link>
    </aside>
  );
}

/**
 * At the top of a brief: "This brief summarizes the completed
 * {type} [Title]  [Open the {type} →]". The type word comes from the
 * shared friendlyType map, so a future type reads sensibly without a
 * change here.
 */
export function BriefSourcePointer({ processId }: { processId: string }) {
  const { source } = useBriefPair(processId);
  if (!source) return null;

  const noun = friendlyType(source.peer.type).toLowerCase();

  return (
    <aside className="brief-pointer brief-pointer--source" aria-label="Summarized process">
      <div className="brief-pointer-text">
        This brief summarizes the completed {noun}{" "}
        <Link to={source.peer.href} className="brief-pointer-title">
          {source.peer.title}
        </Link>
        .
      </div>
      <Link to={source.peer.href} className="brief-pointer-button">
        Open the {noun} &rarr;
      </Link>
    </aside>
  );
}
