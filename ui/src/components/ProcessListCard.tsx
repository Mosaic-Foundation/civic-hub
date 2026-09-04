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

import type { CSSProperties, ReactNode } from "react";
import { statusDisplay } from "./statusDisplay";
import { typeColorSlug } from "./typeColor";
import { friendlyType } from "./ProcessLinkPicker";

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
}

export default function ProcessListCard({ processType, status, title, meta = [] }: Props) {
  const slug = typeColorSlug(processType);
  const items = meta.filter(Boolean);

  return (
    <div
      className="process-card"
      style={{ "--card-accent": `var(--type-${slug}-fg)` } as CSSProperties}
    >
      <div className="process-card-chips">
        <span className={`feed-pill feed-pill--type-${slug}`}>
          {friendlyType(processType)}
        </span>
        <span className={statusDisplay(status).className}>
          {statusDisplay(status).label}
        </span>
      </div>
      <h3 className="process-card-title">{title}</h3>
      {items.length > 0 && (
        <div className="process-card-meta">
          {items.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Sep 8" — the compact form the meta line uses for every date. */
export function cardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
