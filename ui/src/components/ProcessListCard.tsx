// THE card every process list renders. One component, so the four lists
// cannot drift apart again — which is how they got inconsistent in the first
// place: votes, proposals, projects and conversations each wrote their own
// header, and by 2026-09-04 they disagreed on where the status sat, whether
// a type pill existed at all, and whether the creator was shown.
//
// The shape, fixed for every type present and future (Adam, 2026-09-04):
//
//   ┌──────────────────────────────────────┐ ← 4px bar in the type's colour
//   │ [TYPE]                     [STATUS]  │   type left, status right
//   │ Title, full width                    │
//   │ meta · meta · meta                   │
//   └──────────────────────────────────────┘
//
// A new process type gets this by passing its `processType` — the pill label
// comes from `friendlyType` (which humanizes an unregistered type) and the
// colour from `typeColorSlug` (which falls back to a generic accent), so it
// renders sensibly with nothing registered here.

import type { ReactNode } from "react";
import { ListCard, StatusChip } from "../kit";
import { statusDisplay } from "./statusDisplay";
import { typeColorSlug } from "./typeColor";
import { friendlyType } from "./processLinkTypes";
import SampleBadge from "./SampleBadge";

interface Props {
  /** Canonical process type, e.g. "civic.vote" — drives pill, colour, accent. */
  processType: string;
  /** Lifecycle status for the pill; see statusDisplay for the vocabulary. */
  status: string;
  title: string;
  /**
   * The meta line, left to right. Falsy entries are dropped, so a caller can
   * pass conditionals inline without assembling the array first.
   */
  meta?: ReactNode[];
  /** Seeded sample content (Phase 7): adds the Sample badge. */
  sample?: boolean;
}

/**
 * Since Events 3 (2026-11-08) the card itself is the kit's ListCard
 * (kit/patterns.tsx), which plugins draw too; this is the hub's adapter that
 * turns a process type and a raw status into the kit's colour key, labels and
 * tone.
 */
export default function ProcessListCard({ processType, status, title, meta = [], sample = false }: Props) {
  const shown = statusDisplay(status);
  return (
    <ListCard
      kind={typeColorSlug(processType)}
      kindLabel={friendlyType(processType)}
      title={title}
      badges={sample ? <SampleBadge /> : undefined}
      status={<StatusChip tone={shown.tone ?? "done"}>{shown.label}</StatusChip>}
      meta={meta}
    />
  );
}
