import type { DeliberationDraft } from "../../services/api";
import { demoSubmitNote } from "../../config/demoCopy";
import { DAY_MS, durationLabel } from "./durations";
import type { DraftKindConfig } from "./types";
import ConversationForm from "./forms/ConversationForm";


/**
 * Conversation creation: topic + framing only for the assistant (the
 * deliberation handler declares its config through the registry). Residents
 * submit for review; admins are auto-approved and the conversation
 * auto-starts. The duration picker replaces the old deadline date: the
 * deadline is computed when the conversation starts.
 */
export const conversationKind: DraftKindConfig<DeliberationDraft> = {
  kind: "conversation",
  processType: "civic.polis_deliberation",
  emptyDraft: {
    id: "",
    user_id: "",
    title: "",
    description: "",
    sources: "",
    seed_statements: "",
    duration_ms: 42 * DAY_MS,
    participation_threshold: null,
    conversation_history: [],
    last_review_result: null,
    draft_modified_since_review: false,
    assistant_helped: false,
    status: "drafting",
    created_at: "",
    updated_at: "",
    links: [],
  },
  applyFields: () => ["title", "description", "sources", "seed_statements"],
  shell: (ctx) => ({
    backTo: "/deliberations",
    backLabel: "Conversations",
    title: ctx.reviseReviewId ? "Revise your conversation" : "Start a conversation",
  }),
  Form: ConversationForm,
  confirm: {
    title: () => "Submit your conversation",
    previewExtra: (d) => (
      <p className="confirm-duration">
        Open for {durationLabel(d.duration_ms)} once the conversation starts
        {d.participation_threshold
          ? `, or until ${d.participation_threshold} people have participated`
          : ""}.
      </p>
    ),
    finality: (ctx) =>
      ctx.isAdmin
        ? "Once submitted, your conversation goes live and participants can join right away."
        : ctx.hub.demo_mode
          ? demoSubmitNote("conversation")
          : "Your conversation will be submitted for review before going live. You'll be notified when an admin has reviewed it.",
    noun: "conversation",
    audience: "Participants",
    confirmLabel: (ctx) => (ctx.isAdmin ? "Create conversation" : ctx.hub.demo_mode ? "Submit" : "Submit for review"),
  },
  liveUrl: () => "/deliberations",
};
