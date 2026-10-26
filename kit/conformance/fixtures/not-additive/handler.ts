// The straw poll's handler: its actions, and how it reads.

import {
  ConflictError,
  ValidationError,
  closeThroughDispatcher,
  emitEvent,
  isPastDeadline,
  type Process,
  type ProcessAction,
  type ProcessHandler,
} from "@civic-social/plugin-sdk";
import STRAW_POLL_MANIFEST, { TYPE } from "./manifest.js";
import { strawPollStore } from "./store.js";

export interface StrawPollState {
  question: string;
  options: string[];
  /** When it closes (ISO). */
  closes_at: string;
  /** The counts, once it has closed. */
  result: Record<string, number> | null;
}

const DAY_MS = 86_400_000;

function stateOf(process: Process): StrawPollState {
  return process.state as unknown as StrawPollState;
}

function event(process: Process, actor: string) {
  return { actor, process_id: process.id, jurisdiction: process.jurisdiction, processType: TYPE, action_url_path: `/not-additive-poll/${process.id}` };
}

const handler: ProcessHandler = {
  type: TYPE,
  descriptor: STRAW_POLL_MANIFEST.descriptor,
  requiredSchema: [...STRAW_POLL_MANIFEST.requiredSchema],
  detailPath: STRAW_POLL_MANIFEST.detailPath,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    const question = typeof input.question === "string" ? input.question.trim() : "";
    const options = Array.isArray(input.options) ? input.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (!question) throw new ValidationError("A straw poll needs a question.", "question_required");
    if (options.length < 2 || options.length > 6 || new Set(options).size !== options.length) {
      throw new ValidationError("A straw poll needs two to six different options.", "options_invalid");
    }
    const days = Number(input.duration_days ?? 7);
    if (!Number.isFinite(days) || days < 1 || days > 90) throw new ValidationError("A straw poll runs from 1 to 90 days.", "duration_invalid");
    const state: StrawPollState = { question, options, closes_at: new Date(Date.now() + days * DAY_MS).toISOString(), result: null };
    return state as unknown as Record<string, unknown>;
  },

  async handleAction(process: Process, action: ProcessAction): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    switch (action.type) {
      case "answer": {
        const choice = typeof action.payload.choice === "string" ? action.payload.choice : "";
        if (!state.options.includes(choice)) throw new ValidationError("Choose one of the poll's options.", "choice_invalid");
        if ((await strawPollStore.get().insertAnswer({ process_id: process.id, user_id: action.actor, choice })) === "duplicate") {
          throw new ConflictError("You have already answered this poll.", "already_answered");
        }
        // Restricted: who answered is never published, only the counts at the close.
        await emitEvent({ ...event(process, action.actor), event_type: "civic.process.submission_received", visibility: "restricted", data: {} });
        return { status: "answered" };
      }
      case "close": {
        state.result = await strawPollStore.get().counts(process.id);
        process.status = "closed";
        await emitEvent({ ...event(process, action.actor), event_type: "civic.process.ended", data: { process: { type: TYPE } } });
        await emitEvent({
          ...event(process, action.actor),
          event_type: "civic.process.result_published",
          data: { straw_poll_result: { question: state.question, counts: state.options.map((o) => ({ option: o, count: state.result![o] ?? 0 })) } },
        });
        return { status: "closed", result: state.result };
      }
      default:
        throw new ValidationError("That action isn't supported on a straw poll.", "action_not_supported");
    }
  },

  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    return {
      id: process.id,
      type: TYPE,
      title: process.title,
      description: process.description,
      status: process.status,
      question: state.question,
      options: state.options,
      closes_at: state.closes_at,
      result: state.result,
      has_answered: actor ? await strawPollStore.get().hasAnswered(process.id, actor) : false,
      created_at: process.createdAt,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = stateOf(process);
    return { id: process.id, type: TYPE, title: process.title, status: process.status, question: state.question, closes_at: state.closes_at, created_at: process.createdAt };
  },

  // Past its date it reads as closed at once; the hub's close job runs the close.
  readAsClosed(process: Process): Process | null {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).closes_at)) return null;
    return { ...structuredClone(process), status: "closed" };
  },

  async closeIfExpired(process: Process): Promise<Process> {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).closes_at)) return process;
    return closeThroughDispatcher(process, { type: "close", actor: "system:auto-close", payload: {} });
  },

  async participationCount(process: Process): Promise<number | null> {
    const counts = await strawPollStore.get().counts(process.id);
    return Object.values(counts).reduce((n, c) => n + c, 0);
  },
};

export default handler;
