import { createPolisDeliberationHandler } from "./handler.js";
import { createPolisAdapter } from "./adapter/polisAdapter.js";
import { describeSubmissionFields } from "../../src/shared/submissionPreview.js";
import { deliberationDraftKind } from "./draftKind.js";
import {
  emitEvent,
  setDraftStatus,
  generateId,
  closeThroughDispatcher,
  getActionDispatcher,
  afterActionCommits,
  UnavailableError,
  isPastDeadline,
  defaultJurisdiction,
  str,
  getSettingSync,
  KEYS,
  getProcess,
  briefIdForSource,
  type PluginHost,
  type Process,
  type ProcessHandler,
  type RegeneratedBrief,
  type BriefContent,
  type DeliberationResult,
  type DeliberationSummary,
  type FeedProcessMeta,
} from "../../src/sdk/index.js";
import type { PolisHostInterface } from "./hostInterface.js";
import type { PolisAdapter } from "./adapter/types.js";
import type { PolisDeliberationState } from "./types.js";
import { deliberationAssistantConfig } from "./assistantConfig.js";
import { POLIS_DELIBERATION_MANIFEST } from "./manifest.js";
import { conversationHost } from "./host.js";

let _adapter: PolisAdapter | null = null;

export function getPolisAdapter(): PolisAdapter {
  if (!_adapter) throw new Error("Deliberation boot not called yet");
  return _adapter;
}

/**
 * Polis is down, slow or failing (a 5xx, a timeout, no answer): the request
 * answers 503 and says to try again, not the generic 500 (Audit 4's open
 * item, fixed in the cleanup slice, 2026-10-16). A 4xx is Polis refusing
 * this request and stays as it was.
 */
export class PolisUnavailableError extends UnavailableError {
  constructor(cause: string) {
    super("Conversations can't reach Polis right now. Please try again in a moment.", "polis_unavailable", {
      retryAfterSeconds: 30,
      cause,
    });
  }
}

/** A Polis failure as the hub answers it. Exported for its unit test. */
export function asHubError(err: unknown): unknown {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status < 500) return err;
  return new PolisUnavailableError(err instanceof Error ? err.message : String(err));
}

const ADAPTER_METHODS = [
  "createDeliberation",
  "submitStatement",
  "recordVote",
  "getNextStatement",
  "pullClusterState",
  "closeDeliberation",
  "getStatements",
] as const satisfies ReadonlyArray<keyof PolisAdapter>;

export function bootDeliberation(pluginHost: PluginHost): ProcessHandler {
  // The deliberation adapter (ADR-012) says where Polis is, with which token
  // and fetch; read per call, so the hosting layer may install it after this
  // boot. The fake (CIVIC_FAKE_ADAPTERS or CIVIC_POLIS_FAKE, never
  // production) is an in-memory Polis behind the real adapter, with short
  // timeouts, and summaries made without a language model.
  // The address is read per call, for the hub in scope: the hub setting, or
  // the default (the cleanup slice, Audit 3's Polis findings).
  const service = () => pluginHost.adapter("deliberation");
  const polisBaseUrl = (): string => service().baseUrl(getSettingSync(KEYS.PLUGIN_CONVERSATION_POLIS_URL));

  // One real adapter per Polis address and service, made on first use; the
  // hub's adapter picks the one for the hub in scope on every call, and turns
  // an outage into a 503.
  const byUrl = new Map<string, PolisAdapter>();
  const adapterFor = (baseUrl: string): PolisAdapter => {
    const svc = service();
    const cacheKey = `${svc.name} ${baseUrl}`;
    let adapter = byUrl.get(cacheKey);
    if (!adapter) {
      adapter = createPolisAdapter({
        baseUrl,
        authToken: svc.authToken(),
        fetch: svc.fetch,
        ...(svc.timeoutMs !== undefined ? { timeoutMs: svc.timeoutMs } : {}),
        ...(svc.retryDelaysMs !== undefined ? { retryDelaysMs: svc.retryDelaysMs } : {}),
      });
      byUrl.set(cacheKey, adapter);
    }
    return adapter;
  };
  const hubAdapter = {} as Record<(typeof ADAPTER_METHODS)[number], (...args: unknown[]) => Promise<unknown>>;
  for (const method of ADAPTER_METHODS) {
    hubAdapter[method] = async (...args: unknown[]) => {
      const adapter = adapterFor(polisBaseUrl()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      try {
        return await adapter[method]!(...args);
      } catch (err) {
        throw asHubError(err);
      }
    };
  }
  _adapter = hubAdapter as unknown as PolisAdapter;

  // The closed conversation's result, as data: no AI here. Its brief writes
  // the summary from it under the brief's own grant (plugin session 2).
  const pullResult = async (conversationId: string, adapter: PolisAdapter, topic: string): Promise<DeliberationResult> => {
    const [cluster, statements] = await Promise.all([
      adapter.pullClusterState(conversationId),
      adapter.getStatements(conversationId),
    ]);
    return {
      kind: "deliberation",
      topic,
      data_uri: `${polisBaseUrl()}/${conversationId}`,
      ...(service().fake ? { fake: true } : {}),
      participant_count: cluster.participant_count,
      statement_count: cluster.statement_count,
      groups: cluster.groups.map((g) => ({
        id: g.id,
        size: g.size,
        representative_statements: g.representative_statements.map((r) => ({ text: r.text, repness: r.repness, direction: r.direction })),
      })),
      consensus: {
        agree: cluster.consensus.agree.map(({ statement_id, text, agree_rate, vote_count }) => ({ statement_id, text, agree_rate, vote_count })),
        disagree: cluster.consensus.disagree.map(({ statement_id, text, agree_rate, vote_count }) => ({ statement_id, text, agree_rate, vote_count })),
      },
      statements: statements.map((st) => ({ id: st.id, text: st.text })),
    };
  };

  const host: PolisHostInterface = {
    async emitEvent(input) {
      // The shared Polis handler carries the originating process id inside the
      // event `data` (as `process_id` for lifecycle events, or
      // `originating_process_id` for outcome delivery). Lift it to the
      // top-level `process_id` so `GET /events?process_id=` filtering and
      // orphan-event cleanup joins work, per the Civic Event spec.
      const data = input.data as Record<string, unknown>;
      const processId =
        (typeof data.process_id === "string" && data.process_id) ||
        (typeof data.originating_process_id === "string" &&
          data.originating_process_id) ||
        "";
      // Phase 3 — normalize the shared Polis handler's flat `process_type` /
      // `originating_process_type` into the canonical `data.process.type` (via
      // emitEvent's processType stamping) so the feed/digest classifier reads
      // one field across the whole civic.process.* family.
      const processType =
        (typeof data.process_type === "string" && data.process_type) ||
        (typeof data.originating_process_type === "string" &&
          data.originating_process_type) ||
        undefined;
      await emitEvent({
        event_type: input.event_type,
        actor: input.actor,
        process_id: processId,
        jurisdiction: input.jurisdiction || defaultJurisdiction(),
        processType,
        data: input.data,
      });
    },
    generateId(prefix) {
      return generateId(prefix || "id");
    },
    async writeOutcomeDelivery(_slug, _payload) {
      const id = generateId("outcome");
      return { id, delivery_timestamp: new Date().toISOString() };
    },
    async getResponseById(_responseId) {
      return null;
    },
  };

  const shared = createPolisDeliberationHandler({
    adapter: _adapter,
    pullResult,
    host,
    polisBaseUrl,
    afterCommit: afterActionCommits,
    async recordResultLater(processId: string) {
      try {
        await getActionDispatcher()(processId, { type: "record_result", actor: "system:conversation-close", payload: {} });
      } catch (err) {
        console.error(
          `[deliberation] recording ${processId}'s result after its close failed; an admin can regenerate its brief:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  });

  const handler = shared as unknown as ProcessHandler;
  // What this type is, its storage and its detail route: the manifest
  // (./manifest.ts beside the shared handler), which is plain data.
  handler.descriptor = POLIS_DELIBERATION_MANIFEST.descriptor;
  handler.requiredSchema = [...POLIS_DELIBERATION_MANIFEST.requiredSchema];
  handler.detailPath = POLIS_DELIBERATION_MANIFEST.detailPath;

  // The conversation page's whole shape, so GET /deliberations/:id and an
  // action's `view` are the same read: the shared read model plus whether
  // the caller has put a statement in (that table is the hub's, so it is
  // read here, not in the portable shared handler).
  const sharedReadModel = shared.getReadModel.bind(shared);
  handler.getReadModel = async (process: Process, actor?: string) => {
    const model = await sharedReadModel(process as never, actor);
    // Its brief's summary (as published, or as made while unpublished) since
    // plugin session 2; a conversation closed before then shows its own until
    // its brief is made again.
    const fromBrief = await summaryFromBrief(process);
    return {
      ...model,
      ...(fromBrief ? { summary: fromBrief, summary_status: "complete" } : {}),
      has_submitted: actor ? await hasSubmittedStatement(process.id, actor) : false,
    };
  };

  // Drafting: where a creator revises a draft. Set here (not in the portable
  // shared handler) so the shared module stays free of hub-specific routing.
  handler.draftPath = (draftId: string) => `/deliberations/new?draft=${encodeURIComponent(draftId)}`;
  handler.reopenDraft = (draftId: string) => setDraftStatus(deliberationDraftKind.spec, draftId, "drafting");

  // A conversation's submission lives on state (seed statements, sources,
  // window, participant goal) — extend the generic content walk with those
  // keys so the review previews show the whole setup as submitted.
  handler.describeSubmission = (source) =>
    describeSubmissionFields(source, [
      "seed_statements",
      "sources",
      "duration_ms",
      "participation_threshold",
    ]);

  // Approval lands a conversation at "draft" and then starts it: creating the
  // live Polis conversation, passing the seed statements through, and flipping
  // it to "active" so residents can join with no manual admin step.
  //
  // BEST-EFFORT on purpose. Polis is a separate service; an outage there must
  // not undo an admin's approval, and a conversation that rests at "draft" is
  // recoverable — the admin sees a "Start Conversation" button. What the
  // shared service adds, and what was missing when this policy was hardcoded
  // in it, is that the failure now emails an admin instead of only reaching a
  // console.error nobody reads.
  handler.activationOnApproval = () => ({
    status: "draft",
    action: { type: "start", onFailure: "best_effort" },
  });

  // Drafting assistant (topic + framing) — declared here, not in the
  // portable shared handler, for the same reason detailPath is: the
  // shared module stays free of hub-specific modules (the config wires
  // the hub's deliberation_drafts storage).
  handler.getAssistantConfig = () => deliberationAssistantConfig;

  // The deadline close, run by the hourly job: an active deliberation past its deadline runs the
  // shared "close" action through the injected dispatcher (persists status +
  // emits the lifecycle event). The shared handler's close guards its Polis
  // call, so a down/unauthorized Polis backend can't wedge the transition.
  // Wired here (not in the portable shared handler) so the shared module stays
  // free of hub registry imports.
  // Past its deadline and not closed yet by the hourly job: it reads as
  // closed. No write, no Polis call.
  handler.readAsClosed = (process: Process): Process | null => {
    if (process.status !== "active") return null;
    const deadline = (process.state as Record<string, unknown>).deadline as string | null | undefined;
    if (!isPastDeadline(deadline)) return null;
    return { ...structuredClone(process), status: "closed" };
  };

  handler.closeIfExpired = async (process: Process): Promise<Process> => {
    if (process.status !== "active") return process;
    const deadline = (process.state as Record<string, unknown>).deadline as
      | string
      | null
      | undefined;
    if (!isPastDeadline(deadline)) return process;

    console.log(
      `[auto-close] Deliberation ${process.id} past deadline ${deadline}, closing now.`,
    );
    return closeThroughDispatcher(process, {
      type: "close",
      actor: "system:auto-close",
      payload: {},
    });
  };

  // Universal brief: a closed conversation's outcome is its Civic Brief.
  // Reads the already-generated Polis summary off state (no Polis call) and
  // maps it into the type-agnostic BriefContent. Returns null if the summary
  // isn't complete (e.g. summarization failed) — the close then produces no
  // brief rather than an empty one. Wired on the hub side so the portable
  // shared handler stays free of the brief module.
  // Regenerate (Actions slice): ask for the summary again and build the brief
  // from it. The conversation takes the new summary once that version of the
  // brief is published (src/services/briefRegenerate.ts), so the page and the
  // brief show one summary; the brief keeps the versions it replaces.
  // Regenerate (the brief's admin action): the result pulled from Polis again,
  // handed to the brief, which writes the summary again.
  handler.regenerateBrief = async (process: Process): Promise<RegeneratedBrief | null> => {
    const state = process.state as unknown as PolisDeliberationState;
    if (!state.polis_conversation_id || !_adapter) return null;
    let result: DeliberationResult;
    try {
      result = await pullResult(state.polis_conversation_id, _adapter, state.topic);
    } catch (err) {
      console.warn(`[deliberation] reading ${process.id}'s result again failed:`, err instanceof Error ? err.message : err);
      return null;
    }
    const content = handler.generateBrief!({
      ...process,
      state: { ...(process.state as Record<string, unknown>), result },
    }) as BriefContent | null;
    return content ? { content } : null;
  };

  handler.feedMeta = (model: Record<string, unknown>): FeedProcessMeta => ({
    title: str(model.title) ?? str(model.topic),
    description: str(model.description) ?? str(model.framing),
  });

  // Participation for the public descriptor (Architecture 3). Statements live
  // in Polis, so the hub has a count only once the close stored the summary's
  // participation_stats; while the conversation runs there is none to serve.
  handler.participationCount = async (process: Process): Promise<number | null> => {
    const state = process.state as unknown as PolisDeliberationState;
    const participants = state.summary?.participation_stats?.total_participants ?? state.result?.participant_count;
    return typeof participants === "number" ? participants : null;
  };

  // The brief is made from the result the close recorded; the brief writes
  // the summary and lays it out (packages/civic.brief/finalize.ts). A
  // conversation closed before plugin session 2 made its brief from its own
  // summary when it closed, and has one.
  handler.generateBrief = (process: Process): BriefContent | null => {
    const state = process.state as unknown as PolisDeliberationState;
    if (!state.result) return null;
    const topic = state.topic || process.title;
    return {
      title: topic,
      headline: `Where the community landed on "${topic}"`,
      summary: "",
      sections: [],
      participation_label: null,
      participation_count: state.result.participant_count,
      comments: [],
      admin_notes: "",
      source_result: { ...state.result, topic },
    };
  };

  return handler;
}

/** The summary its brief wrote (a conversation closed since plugin session 2), or null. */
async function summaryFromBrief(process: Process): Promise<DeliberationSummary | null> {
  if (process.status !== "closed" && process.status !== "finalized") return null;
  const briefId = await briefIdForSource(process.id);
  const brief = briefId ? await getProcess(briefId) : null;
  const content = (brief?.state as { content?: BriefContent } | undefined)?.content;
  return content?.deliberation ?? null;
}

/** Whether this person has put a statement into this conversation. */
async function hasSubmittedStatement(processId: string, userId: string): Promise<boolean> {
  const row = await conversationHost.get()
    .db()
    .from("deliberation_submissions")
    .select<{ user_id: string }>("user_id")
    .eq("process_id", processId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!row;
}
