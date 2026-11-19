// Briefs' pointers between a brief and the process it summarizes. The source's
// is Briefs' contribution to every process page (`contributes.processTop`, kernel
// step 3): the kernel draws whatever packages add there and names none; Briefs
// draws this, and nothing while Briefs is off. Moved from the hub's
// components/BriefPointer.tsx.

import { Link } from "react-router-dom";
import { absoluteDate, typeName, useApi, useSpace } from "@civic-social/plugin-sdk/ui";
import { getProcessLinks, getPublicBrief, type PublicBrief, type RenderedLink } from "./api";
import { heldBackLine, joinNames } from "./briefDelivery";
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
} {
  // A failed link read must never take the page down — the pointer is a
  // convenience on top of the record, not the record: no pair, nothing shown.
  const { data: links } = useApi(`process/${processId}/links`, () => getProcessLinks(processId));
  return {
    brief: links?.incoming.find((l) => l.id.startsWith(BRIEF_OF_PREFIX)) ?? null,
    source: links?.outgoing.find((l) => l.id.startsWith(BRIEF_SOURCE_PREFIX)) ?? null,
  };
}

function deliveryLine(brief: PublicBrief, governingBodyRef: string): string {
  if (brief.sent_to.length > 0 && brief.delivered_at) {
    return `Sent to ${joinNames(brief.sent_to)} on ${absoluteDate(brief.delivered_at)}.`;
  }
  if (brief.delivered_recipient_count > 0) {
    return `Sent to ${governingBodyRef}.`;
  }
  const held = heldBackLine(brief);
  if (held) return held;
  return `Published ${absoluteDate(brief.published_at)}.`;
}

/**
 * On a process page: "This {type} is complete — its final brief is
 * published. Sent to … on …  [Read the brief →]". Renders nothing until
 * a brief exists for this process.
 */
export function BriefPointer({ processId }: { processId: string }) {
  const space = useSpace();
  const { brief } = useBriefPair(processId);

  // The button still works without the receipt line, so a failed read shows none.
  const briefId = brief?.peer.id ?? null;
  const { data: detail } = useApi<PublicBrief>(briefId ? `brief/${briefId}` : null, () => getPublicBrief(briefId!));

  if (!brief) return null;

  return (
    <aside className="brief-pointer" aria-label="Final brief">
      <div className="brief-pointer-text">
        <strong>The final brief is published.</strong>
        {detail && <span className="brief-pointer-sub"> {deliveryLine(detail, space.governingBodyRef)}</span>}
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
 * type's own name (typeName), so a future type reads sensibly without a
 * change here.
 */
export function BriefSourcePointer({ processId }: { processId: string }) {
  const { source } = useBriefPair(processId);
  if (!source) return null;

  const noun = typeName(source.peer.type).toLowerCase();

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
