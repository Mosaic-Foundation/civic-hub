import type { ProposalDraft } from "../../services/api";
import { demoSubmitNote } from "../../config/demoCopy";
import { DAY_MS, durationLabel } from "./durations";
import type { DraftKindConfig } from "./types";
import ProposalForm from "./forms/ProposalForm";


export const proposalKind: DraftKindConfig<ProposalDraft> = {
  kind: "proposal",
  processType: "civic.proposal",
  createBody: { category: "idea" },
  emptyDraft: {
    id: "",
    user_id: "",
    category: "idea",
    title: "",
    description: "",
    sources: "",
    considerations: "",
    proposal_duration_ms: 42 * DAY_MS,
    conversation_history: [],
    last_review_result: null,
    draft_modified_since_review: false,
    steward_approved: null,
    assistant_helped: false,
    status: "drafting",
    created_at: "",
    updated_at: "",
    links: [],
  },
  applyFields: () => ["title", "description", "sources"],
  shell: (ctx) => ({
    backTo: "/propose",
    backLabel: "Proposals",
    title: ctx.reviseReviewId ? "Revise your proposal" : "Propose something",
  }),
  Form: ProposalForm,
  confirm: {
    title: () => "Submit your proposal",
    afterPreview: (d) => (
      <p className="confirm-duration">
        This proposal will stay open for{" "}
        {Number.isFinite(d.proposal_duration_ms) && d.proposal_duration_ms > 0
          ? // Retired option: still labels pre-2026-08-28 drafts that carry it.
            durationLabel(d.proposal_duration_ms, { [180 * DAY_MS]: "6 months" })
          : "90 days"}
        .
      </p>
    ),
    finality: (ctx) =>
      ctx.isAdmin
        ? "Once submitted, your proposal cannot be edited. Please make sure everything looks the way you want it before submitting."
        : ctx.hub.demo_mode
          ? demoSubmitNote("proposal")
          : "Your proposal will be submitted for review before going live. You'll be notified when an admin has reviewed it.",
    noun: "proposal",
    audience: "Readers",
    confirmLabel: (ctx) => (ctx.isAdmin ? "Submit proposal" : ctx.hub.demo_mode ? "Submit" : "Submit for review"),
  },
  liveUrl: (id) => `/proposal/${id}`,
};
