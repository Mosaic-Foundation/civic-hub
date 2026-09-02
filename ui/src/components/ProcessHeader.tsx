// ProcessHeader — the one header every process detail page uses (2026-09-02).
//
// Adam, on a phone: "the title is cramped… it's not clear that it is a
// proposal." Before this, each detail page laid out its own header — a
// title squeezed beside a status pill, and nothing anywhere saying what
// kind of process you were looking at. Now every page stacks the same way:
//
//   PROPOSAL                      ← what this is (type pill)
//   The full-width title
//   ● Gathering support           ← where it is (status badge)
//
// The type label comes from the shared friendlyType map, which falls back
// to a humanized type string, so a process type added later renders a
// sensible pill with no change here.

import type { ReactNode } from "react";
import { friendlyType } from "./ProcessLinkPicker";
import type { StatusDisplay } from "./statusDisplay";
import "./ProcessHeader.css";

interface Props {
  /** Registry type, e.g. "civic.proposal". */
  type: string;
  title: string;
  /** From statusDisplay(); omit for pages without a lifecycle badge. */
  status?: StatusDisplay | null;
  /** Anything that belongs on the status line beside the badge (a share
   *  button, a jurisdiction tag). */
  aside?: ReactNode;
  /** Optional meta row under the status line (creator, dates). */
  children?: ReactNode;
}

export default function ProcessHeader({ type, title, status, aside, children }: Props) {
  return (
    <header className="process-header-block">
      <span className="process-type-pill">{friendlyType(type)}</span>
      <h1 className="process-header-title">{title}</h1>
      {(status || aside) && (
        <div className="process-header-status">
          {status && <span className={status.className}>{status.label}</span>}
          {aside}
        </div>
      )}
      {children}
    </header>
  );
}
