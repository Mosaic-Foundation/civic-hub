import { createPolisDeliberationHandler } from "../shared/polis_deliberation/handler.js";
import { createPolisAdapter } from "../shared/polis_deliberation/adapter/polisAdapter.js";
import { createPolisSummarizer } from "../shared/polis_deliberation/summarization/polisSummarizer.js";
import { emitEvent } from "../events/eventEmitter.js";
import { generateId } from "../utils/id.js";
import { callClaude, DEFAULT_MODEL } from "../utils/anthropic.js";
import { getActionDispatcher } from "./registry.js";
import { isPastDeadline } from "../utils/deadline.js";
import type { Process } from "../models/process.js";
import type { ProcessHandler } from "./types.js";
import type { PolisHostInterface } from "../shared/polis_deliberation/hostInterface.js";
import type { PolisAdapter } from "../shared/polis_deliberation/adapter/types.js";
import type { PolisDeliberationState } from "../shared/polis_deliberation/types.js";
import type { BriefContent, BriefSection } from "../modules/civic.brief/index.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../config/hub.js";


let _adapter: PolisAdapter | null = null;

export function getPolisAdapter(): PolisAdapter {
  if (!_adapter) throw new Error("Deliberation boot not called yet");
  return _adapter;
}

export function bootDeliberation(): ProcessHandler {
  const polisBaseUrl = process.env.POLIS_BASE_URL || "https://polis.civic.social";
  const polisAuthToken = process.env.POLIS_AUTH_TOKEN || "";

  if (!polisAuthToken) {
    console.log(
      "[deliberation] POLIS_AUTH_TOKEN not set — deliberation handler will fail on Polis API calls",
    );
  }

  _adapter = createPolisAdapter({
    baseUrl: polisBaseUrl,
    authToken: polisAuthToken,
  });

  const llmClient = {
    async complete(params: {
      system: string;
      user: string;
      maxTokens: number;
    }): Promise<string> {
      const result = await callClaude({
        model: DEFAULT_MODEL,
        system: params.system,
        userText: params.user,
        maxTokens: params.maxTokens,
      });
      return result.text;
    },
  };

  const summarize = createPolisSummarizer({
    llmClient,
    polisBaseUrl,
  });

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
        hub_id: HUB_ID,
        jurisdiction: input.jurisdiction || DEFAULT_JURISDICTION,
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
    summarize,
    host,
    polisBaseUrl,
  });

  const handler = shared as unknown as ProcessHandler;

  // Storage this process type owns. Declared on the boot side rather than in
  // the portable shared handler, for the same reason closeIfExpired is: the
  // shared module stays free of hub-specific imports. A hub that doesn't
  // register deliberation never probes these tables.
  // Detail route for this type. Set here (not in the portable shared handler)
  // for the same reason requiredSchema is: the shared module stays free of
  // hub-specific routing.
  handler.detailPath = (id: string) => `/deliberation/${id}`;

  handler.requiredSchema = [
    {
      table: "deliberation_submissions",
      columns: ["process_id", "user_id"],
      owner: "civic.polis_deliberation",
    },
    {
      table: "deliberation_votes",
      columns: ["process_id", "user_id", "statement_id"],
      owner: "civic.polis_deliberation",
    },
  ];

  // Lazy deadline-close: an active deliberation past its deadline runs the
  // shared "close" action through the injected dispatcher (persists status +
  // emits the lifecycle event). The shared handler's close guards its Polis
  // call, so a down/unauthorized Polis backend can't wedge the transition.
  // Wired here (not in the portable shared handler) so the shared module stays
  // free of hub registry imports.
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
    const { process: updated } = await getActionDispatcher()(process.id, {
      type: "close",
      actor: "system:auto-close",
      payload: {},
    });
    return updated;
  };

  // Universal brief: a closed conversation's outcome is its Civic Brief.
  // Reads the already-generated Polis summary off state (no Polis call) and
  // maps it into the type-agnostic BriefContent. Returns null if the summary
  // isn't complete (e.g. summarization failed) — the close then produces no
  // brief rather than an empty one. Wired on the hub side so the portable
  // shared handler stays free of the brief module.
  handler.generateBrief = (process: Process): BriefContent | null => {
    const state = process.state as unknown as PolisDeliberationState;
    const summary = state.summary;
    if (!summary || state.summary_status !== "complete") return null;

    const topic = state.topic || process.title;
    const sections: BriefSection[] = [];

    if (summary.top_consensus_statements?.length) {
      sections.push({
        heading: "Where the community agreed",
        body: summary.top_consensus_statements
          .map(
            (s) =>
              `• ${s.statement_text} (${Math.round(s.agree_rate * 100)}% agreed, ${s.vote_count} votes)`,
          )
          .join("\n"),
      });
    }

    if (summary.opinion_groups?.length) {
      sections.push({
        heading: "Where opinions differed",
        body: summary.opinion_groups
          .map((g) => {
            const reps = (g.representative_statements ?? [])
              .map((r) => `   – ${r.text}`)
              .join("\n");
            return `Group of ${g.size} participant(s):\n${reps}`;
          })
          .join("\n\n"),
      });
    }

    if (summary.directed_questions?.length) {
      sections.push({
        heading: "Questions this raised",
        body: summary.directed_questions.map((q) => `• ${q}`).join("\n"),
      });
    }

    const stats = summary.participation_stats;
    return {
      title: topic,
      headline: `Where the community landed on "${topic}"`,
      summary: summary.summary_text ?? "",
      sections,
      participation_label: stats
        ? `${stats.total_participants} participant(s) · ${stats.total_statements} statement(s)`
        : null,
      participation_count: stats?.total_participants ?? null,
      comments: [],
      admin_notes: "",
    };
  };

  return handler;
}
