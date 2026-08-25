// civic.proposal process handler — thin adapter around the civic.proposals module.
//
// A Proposal is an idea board: float an idea, gauge interest/discussion. It is
// NOT a vote and does not convert into one (the "gather support → become a
// vote" mechanism lives in the civic.vote `proposal_required` lifecycle, not
// here). See /decisions/audit-2026-06-25-process-and-feed-consistency.md.
//
// Proposals are NOT driven through the generic /process/:id/action dispatcher.
// Intake and endorsement happen via the /proposals HTTP surface and the
// civic.proposals module's own service functions, which own the relational
// `proposals` table. This adapter exists so proposals live in the same process
// store and register as a known process type for the unified read layer
// (getAllProcesses / listProcessSummaries), discovery, and the dispatch loop.
//
// Because the module's rich read models are async (they query the `proposals`
// table) and the ProcessHandler read interface is synchronous, this adapter
// returns only the canonical fields carried on the `processes` row. Full
// proposal detail continues to be served by the dedicated /proposals routes.

import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import { emitEvent } from "../events/eventEmitter.js";
import { closeExpiredProposal, getProposal } from "../modules/civic.proposals/index.js";
import { getInputsByProcess } from "../modules/civic.input/index.js";
import { spawnBriefFromClosedProcess, findExistingBriefId } from "./spawnBrief.js";
import type { BriefContent } from "../modules/civic.brief/index.js";

const proposalAdapter: ProcessHandler = {
  type: "civic.proposal",
  detailPath: (id: string) => `/proposal/${id}`,

  // The relational `proposals` row holds proposal state; the canonical
  // `processes` row needs no type-specific state.
  initializeState(): Record<string, unknown> {
    return {};
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new Error(
      `civic.proposal does not accept generic process actions (received "${action.type}"). ` +
        `Support a proposal via the /proposals/:id/support endpoint.`,
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      description: process.description,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  // Lazy deadline-close: when a live proposal's closes_at has elapsed, the
  // module transitions it to "closed" (child row + canonical processes row) and
  // emits civic.proposal.closed. The processes row is the source of truth for
  // the canonical status carried here, so reflect the new status in-memory for
  // the summary/read model produced right after this returns.
  async closeIfExpired(process: Process): Promise<Process> {
    if (process.status !== "active") return process;
    const closed = await closeExpiredProposal(process.id, emitEvent);
    if (closed) {
      process.status = "closed";
      // Spawn the proposal's brief here (proposal close doesn't run through
      // executeAction, so the universal seam can't fire). Best-effort +
      // idempotent — a brief failure must not wedge the close.
      try {
        if (!(await findExistingBriefId(process.id))) {
          await spawnBriefFromClosedProcess(process, "system:proposal-close");
        }
      } catch (err) {
        console.warn(
          `[brief] spawn on proposal close ${process.id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return process;
  },

  // Universal brief: a closed proposal's outcome is how much support it drew.
  async generateBrief(process: Process): Promise<BriefContent | null> {
    const proposal = await getProposal(process.id);
    if (!proposal) return null;
    const support = proposal.support_count ?? 0;

    let comments: string[] = [];
    try {
      const inputs = await getInputsByProcess(process.id);
      comments = inputs.map((i) => i.body.trim()).filter((b) => b.length > 0);
    } catch {
      // Best-effort — admin can add comments during review.
    }

    const supporters = `${support} resident${support === 1 ? "" : "s"}`;
    return {
      title: process.title,
      headline:
        support > 0
          ? `Proposal closed with ${supporters} in support`
          : "Proposal closed",
      summary: process.description ?? "",
      sections: [
        {
          heading: "Support",
          body: `${supporters} endorsed this proposal during its support window.`,
        },
      ],
      participation_label: `${support} endorsement${support === 1 ? "" : "s"}`,
      participation_count: support,
      comments,
      admin_notes: "",
    };
  },
};

export default proposalAdapter;
