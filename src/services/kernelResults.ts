// results: what a closed process came to, as the package that publishes
// results reads and settles it (kernel step 1, docs/kernel/SURFACE.md,
// "Results"). Any process type may say what it came to (its handler's
// generateBrief / regenerateBrief, the process.result contract in
// src/processes/contracts/briefContent.ts); the package that writes results
// up (Briefs) reads it here, never another package's code, and settles the
// process here once the result is public. The kernel names no package: it
// asks the process's own type.
//
// Step 3 turns the reading into the kernel's process.closed event, which
// carries the result (docs/kernel/SURFACE.md, "Event: couplings that go").

import type { CivicEvent, CreateEventInput } from "../models/event.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getProcessHandler, processDetailPath } from "../processes/registry.js";
import { getProcess, isTerminalStatus, saveProcessState } from "./processService.js";
import { closedEarlyView } from "./closeEarly.js";
import type { BriefContent } from "../processes/contracts/briefContent.js";
import type { ProcessStatus } from "../models/process.js";
import type { RegeneratedBrief } from "../processes/types.js";

/** A process of any type, as a result about it reads it. */
export interface ResultSource {
  id: string;
  type: string;
  title: string;
  status: ProcessStatus;
  jurisdiction: string;
  /** Closed or finalized: it has a result to write up. */
  closed: boolean;
}

/** What a closed process came to, as its type says now. */
export interface FreshResult {
  content: BriefContent;
  /** What the process itself takes when this result is published (a conversation's new summary). */
  source_state?: Record<string, unknown>;
  /** How it closed early, when an admin closed it before its deadline. */
  closed_early?: { line: string; note: string };
}

export const results = {
  /** The process, of any type, or undefined. */
  async source(id: string): Promise<ResultSource | undefined> {
    const p = await getProcess(id);
    if (!p) return undefined;
    return {
      id: p.id,
      type: p.definition.type,
      title: p.title,
      status: p.status,
      jurisdiction: p.jurisdiction,
      closed: isTerminalStatus(p.status),
    };
  },

  /**
   * What the process came to, made again by its type (its handler's
   * regenerateBrief, else generateBrief), or null when its type makes none or
   * cannot just now.
   */
  async fresh(id: string): Promise<FreshResult | null> {
    const source = await getProcess(id);
    if (!source) return null;
    const handler = getProcessHandler(source.definition.type);
    if (!handler?.generateBrief) return null;
    const made: RegeneratedBrief | null = handler.regenerateBrief
      ? await handler.regenerateBrief(source)
      : await Promise.resolve(handler.generateBrief(source)).then((c) => (c ? { content: c } : null));
    if (!made) return null;
    const early = closedEarlyView(source.state);
    return {
      content: made.content,
      ...(made.source_state ? { source_state: made.source_state } : {}),
      ...(early ? { closed_early: { line: early.line, note: early.note } } : {}),
    };
  },

  /**
   * What the process keeps from this written-up result, as its type says
   * (its handler's keepResult), or null for nothing.
   */
  async kept(id: string, content: BriefContent): Promise<Record<string, unknown> | null> {
    const source = await getProcess(id);
    if (!source) return null;
    const keep = getProcessHandler(source.definition.type)?.keepResult;
    const state = keep ? keep(source, content) : null;
    return state && Object.keys(state).length > 0 ? state : null;
  },

  /**
   * The process keeps what its type keeps from this written-up result, at
   * once and quietly: the result was written up as the process closed (or an
   * unpublished version was made again), so no event. A value it replaces is
   * kept on the process (`brief_revisions`), as `adopt` keeps it. Nothing
   * happens when the type keeps nothing or it is already in place.
   */
  async keep(id: string, content: BriefContent, by: { resultId: string; at: string }): Promise<void> {
    const kept = await results.kept(id, content);
    if (!kept) return;
    const source = await getProcess(id);
    if (!source) return;
    const state = source.state as Record<string, unknown>;
    if (Object.entries(kept).every(([k, v]) => JSON.stringify(state[k]) === JSON.stringify(v))) return;
    const replaced = Object.keys(kept).filter((k) => state[k] !== undefined && state[k] !== null);
    const previous = Object.fromEntries(replaced.map((k) => [k, state[k]]));
    const history = Array.isArray(state.brief_revisions) ? (state.brief_revisions as unknown[]) : [];
    source.state = {
      ...state,
      ...kept,
      ...(replaced.length > 0
        ? { brief_revisions: [...history, { brief_id: by.resultId, replaced_at: by.at, previous }] }
        : {}),
    };
    await saveProcessState(source);
  },

  /**
   * The process takes the state a published result brought (a conversation's
   * new summary). The values it replaces are kept on the process
   * (`brief_revisions`), and it emits civic.process.updated. Nothing happens
   * when the state is already in place (a retry).
   */
  async adopt(
    id: string,
    sourceState: Record<string, unknown> | null | undefined,
    by: { resultId: string; actor: string; at: string },
  ): Promise<void> {
    if (!sourceState || Object.keys(sourceState).length === 0) return;
    const source = await getProcess(id);
    if (!source) return;
    const state = source.state as Record<string, unknown>;
    if (Object.entries(sourceState).every(([k, v]) => JSON.stringify(state[k]) === JSON.stringify(v))) return;
    const previous = Object.fromEntries(Object.keys(sourceState).map((k) => [k, state[k] ?? null]));
    const kept = Array.isArray(state.brief_revisions) ? (state.brief_revisions as unknown[]) : [];
    source.state = {
      ...state,
      ...sourceState,
      brief_revisions: [...kept, { brief_id: by.resultId, replaced_at: by.at, previous }],
    };
    await saveProcessState(source);
    await emitEvent({
      event_type: "civic.process.updated",
      actor: by.actor,
      process_id: source.id,
      jurisdiction: source.jurisdiction,
      processType: source.definition.type,
      action_url_path: processDetailPath(source.definition.type, source.id),
      data: { brief_revision: { brief_id: by.resultId, fields: Object.keys(sourceState) } },
    });
  },

  /**
   * Its result is public: the process is finalized. Its type decides how when
   * its handler has finalizeAfterBrief (a vote tallies its ballots); otherwise
   * it simply becomes finalized. Best effort and idempotent: a missing process
   * is skipped, a finalized one left as it is. `emit` stamps its events (a
   * sample's, at their planned time); the hub's emitter when left out.
   */
  async finalize(id: string, actor: string, emit?: (input: CreateEventInput) => Promise<CivicEvent>): Promise<void> {
    const src = await getProcess(id);
    if (!src || src.status === "finalized") return;
    const handler = getProcessHandler(src.definition.type);
    if (handler?.finalizeAfterBrief) {
      await handler.finalizeAfterBrief(src, actor, emit);
      await saveProcessState(src);
      return;
    }
    src.status = "finalized";
    await saveProcessState(src);
  },
};
