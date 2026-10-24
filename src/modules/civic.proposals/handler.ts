// civic.proposal process handler — thin adapter around the civic.proposals module.
//
// A Proposal is an idea board: float an idea, gauge interest/discussion. It is
// NOT a vote and does not convert into one (the "gather support → become a
// vote" mechanism lives in the civic.vote `proposal_required` lifecycle, not
// here). See /decisions/audit-2026-06-25-process-and-feed-consistency.md.
//
// One action path (2026-10-12): support, withdrawing support and the close run
// through executeAction like every other type's actions, so the close changes
// status through transition_process (refused if anything wrote the row first,
// one close and one brief however many readers notice the deadline) and the
// descriptor below is checked against each of them. The /proposals routes are
// thin wrappers over executeAction. The `proposals` row keeps its own copy of
// the status for its read model: written after the process row commits
// (afterActionCommits), never before.

import { ValidationError } from "../../errors/index.js";
import { Process, ProcessAction } from "../../models/process.js";
import { ProcessHandler } from "../../processes/types.js";
import { emitEvent } from "../../events/eventEmitter.js";
import { readProcessState, writeProcessState } from "../../services/processRows.js";
import { proposalsStore } from "./store.js";
import {
  createProposal,
  getProposal,
  supportProposal,
  withdrawProposalSupport,
  markProposalClosed,
  getProposalReadModel,
} from "./index.js";
import { emitProposalClosed } from "./events.js";
import { closeThroughDispatcher } from "../../processes/registry.js";
import { afterActionCommits } from "../../services/actionScope.js";
import { isPastDeadline } from "../../utils/deadline.js";
import { getInputsByProcess } from "../civic.input/index.js";
import type { BriefContent } from "../civic.brief/index.js";
import { proposalAssistantConfig } from "./assistantConfig.js";
import { setDraftStatus } from "../civic.drafts/index.js";
import { proposalDraftKind } from "../../processes/draftKinds.js";
import { hubKindOf, participantNoun } from "../../shared/hubKind.js";
import { getSettingSync } from "../../services/hubSettings.js";
import { KEYS } from "../../models/hubSettings.js";
import { PROPOSAL_MANIFEST } from "./manifest.js";

// What the people taking part are called on this hub (review R29, 2026-10-07).
const hubNoun = (n: number): string =>
  participantNoun(hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), n, getSettingSync(KEYS.COPY_RESIDENT_NOUN));

/** The actor a deadline close runs as (the hourly job). */
const AUTO_CLOSE_ACTOR = "system:auto-close";

/** How long a proposal is open when its submission carries no duration (as before 2026-10-12). */
const DEFAULT_PROPOSAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const proposalAdapter: ProcessHandler = {
  type: "civic.proposal",
  descriptor: PROPOSAL_MANIFEST.descriptor,
  requiredSchema: [...PROPOSAL_MANIFEST.requiredSchema],
  detailPath: PROPOSAL_MANIFEST.detailPath,
  draftPath: (draftId: string) => `/propose/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => setDraftStatus(proposalDraftKind.spec, draftId, "drafting"),

  getAssistantConfig: () => proposalAssistantConfig,

  // The relational `proposals` row holds proposal state; the canonical
  // `processes` row needs no type-specific state.
  initializeState(): Record<string, unknown> {
    return {};
  },

  // The proposals row is created when the review is approved, keyed by the
  // canonical process id, so the processes row stays the permanent record.
  async onApproved(process: Process, creatorId: string): Promise<void> {
    const content = (process.content ?? {}) as Record<string, unknown>;
    const durationMs = (content.proposal_duration_ms as number) || DEFAULT_PROPOSAL_DURATION_MS;
    await createProposal(
      {
        id: process.id,
        title: process.title,
        description: process.description || undefined,
        optional_links: (content.optional_links as string[]) ?? undefined,
        submitted_by: creatorId,
        category: (content.category as string) ?? undefined,
        assistant_helped: (content.assistant_helped as boolean) ?? false,
        closes_at: new Date(Date.now() + durationMs).toISOString(),
      },
      emitEvent,
    );
  },

  async handleAction(process: Process, action: ProcessAction): Promise<Record<string, unknown>> {
    switch (action.type) {
      case "process.support": {
        const proposal = await supportProposal(process.id, action.actor, emitEvent);
        return { support_count: proposal.support_count, status: proposal.status };
      }
      case "process.unsupport": {
        const proposal = await withdrawProposalSupport(process.id, action.actor, emitEvent);
        return { support_count: proposal.support_count, status: proposal.status };
      }
      case "process.close": {
        const proposal = await getProposal(process.id);
        process.status = "closed";
        await emitProposalClosed(
          { proposal_id: process.id, emit: emitEvent },
          action.actor,
          { support_count: proposal?.support_count ?? 0 },
          action.at,
        );
        const id = process.id;
        await afterActionCommits(() => markProposalClosed(id));
        return { status: "closed" };
      }
      default:
        throw new ValidationError(
          "That action isn't supported on a proposal.",
          "action_not_supported",
        );
    }
  },

  // The proposal page's own shape (GET /proposals/:id reads it here too), so
  // an action's `view` is what the page shows. The submitter is `created_by`,
  // which the service resolves to a byline and removes.
  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const model = await getProposalReadModel(process.id, actor);
    if (!model) {
      return { id: process.id, type: process.definition.type, title: process.title, status: process.status, created_by: process.createdBy };
    }
    const { submitted_by, ...rest } = model;
    // The page's status is the proposals row's. A proposal that reads as
    // closed at its deadline (readAsClosed) shows closed while its row still
    // says submitted; once the job closes it, the row says closed too.
    const status = process.status === "closed" && rest.status === "submitted" ? "closed" : rest.status;
    return { ...rest, status, type: process.definition.type, created_by: submitted_by ?? process.createdBy };
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

  // Past closes_at and not closed yet by the hourly job: it reads as closed.
  // No write.
  // Participation for the public descriptor (Architecture 3): how many
  // people support the proposal — the same count its public events carry.
  async participationCount(process: Process): Promise<number | null> {
    const proposal = await getProposal(process.id);
    return typeof proposal?.support_count === "number" ? proposal.support_count : null;
  },

  async readAsClosed(process: Process): Promise<Process | null> {
    if (process.status !== "active") return null;
    const proposal = await getProposal(process.id);
    if (!proposal || !isPastDeadline(proposal.closes_at)) return null;
    return { ...structuredClone(process), status: "closed" };
  },

  // The deadline close, run by the hourly job: an active proposal past its
  // closes_at runs the close action through the shared dispatcher, claimed
  // once (processService.closeAtDeadline); its brief comes from the universal
  // seam in executeAction, like every other type's.
  async closeIfExpired(process: Process): Promise<Process> {
    if (process.status !== "active") return process;
    const proposal = await getProposal(process.id);
    if (!proposal || !isPastDeadline(proposal.closes_at)) return process;
    return closeThroughDispatcher(process, {
      type: "process.close",
      actor: AUTO_CLOSE_ACTOR,
      payload: {},
      at: new Date(proposal.closes_at!).toISOString(),
    });
  },

  // Universal brief: a closed proposal's outcome is how much support it drew.

  /**
   * The `proposals` table carries its own status, and getProposal reads THAT
   * copy — so archiving only the processes row would hide the proposal from
   * the public list while /proposal/:id still rendered it as live.
   *
   * The child's PREVIOUS status is stashed into the archive metadata on the
   * way in, because the two vocabularies do not correspond: a process may be
   * `finalized` while its proposal row is `closed`, and there is no mapping
   * that recovers one from the other. Deriving it was the first version of
   * this, and it silently restored a closed proposal as `submitted`.
   */
  async onArchive(process: Process): Promise<void> {
    const previous = (await proposalsStore.get().statusOf(process.id)) ?? "submitted";

    // Re-read: archiveProcess has already written state with its archive meta.
    const state = (await readProcessState(process.id)) ?? {};
    const archive = { ...((state.archive as Record<string, unknown>) ?? {}) };
    archive.child_previous_status = previous;
    state.archive = archive;

    await writeProcessState(process.id, state);
    process.state = state;

    await proposalsStore.get().setStatus(process.id, "archived");
  },

  async onRestore(
    _process: Process,
    _previousStatus: string,
    archiveMeta: Record<string, unknown> | null,
  ): Promise<void> {
    // Put the child row back exactly where it was, using the value onArchive
    // stashed. restoreProcess has already stripped state.archive by now, which
    // is why this arrives as an argument rather than off the process.
    const stashed = archiveMeta?.child_previous_status;
    const known = ["submitted", "closed", "endorsed", "converted"];
    const next =
      typeof stashed === "string" && known.includes(stashed) ? stashed : "submitted";

    await proposalsStore.get().setStatus(_process.id, next);
  },

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

    const supporters = `${support} ${hubNoun(support)}`;
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
