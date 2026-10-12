import { type VoteDraft } from "../../services/api";
import { voteAssistantFields, optionsToText, textToOptions } from "../../services/voteMethods";
import { demoSubmitNote } from "../../config/demoCopy";
import hub from "../../config/hub";
import { DAY_MS, durationLabel } from "./durations";
import type { DraftKindConfig } from "./types";
import VoteForm from "./forms/VoteForm";


export const voteKind: DraftKindConfig<VoteDraft> = {
  kind: "vote",
  processType: "civic.vote",
  emptyDraft: {
    id: "",
    user_id: "",
    title: "",
    description: "",
    sources: "",
    voting_duration_ms: 42 * DAY_MS,
    method: "yes_no_unsure",
    custom_options: null,
    conversation_history: [],
    last_review_result: null,
    draft_modified_since_review: false,
    assistant_helped: false,
    status: "drafting",
    created_at: "",
    updated_at: "",
    links: [],
  },
  // The assistant treats options as one-per-line text; the draft stores an
  // array. Every draft handed to the flow carries the text form, and a patch
  // of that text is turned back into the array before it is saved.
  toFlow: (d) => ({ ...d, options: optionsToText(d.custom_options) }),
  toServer: (patch) => {
    if (!("options" in patch)) return patch;
    const { options, ...rest } = patch;
    return { ...rest, custom_options: textToOptions(String(options ?? "")) };
  },
  applyFields: (s) => voteAssistantFields(String(s.method ?? "yes_no_unsure")),
  shell: (ctx) => ({
    backTo: "/votes",
    backLabel: "Votes",
    title: ctx.reviseReviewId ? "Revise your vote" : "Suggest a vote",
  }),
  Form: VoteForm,
  confirm: {
    title: () => "Submit your vote",
    previewExtra: (d) => (
      <>
        {d.method === "approval" && d.custom_options && (
          <div className="confirm-options">
            <p className="confirm-options-label">Options:</p>
            <ul className="confirm-options-list">
              {d.custom_options.map((opt, i) => (
                <li key={i}>{opt}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="confirm-duration">
          Voting method: {d.method === "approval" ? "Approval" : "Yes / No / Unsure"}.
          Voting will stay open for {durationLabel(d.voting_duration_ms)}.
        </p>
      </>
    ),
    finality: (ctx) =>
      ctx.isAdmin
        ? "Once submitted, your vote cannot be edited. Please make sure everything looks the way you want it before submitting."
        : hub.demo_mode
          ? demoSubmitNote("vote")
          : "Your vote will be submitted for review before going live. You'll be notified when an admin has reviewed it.",
    noun: "vote",
    audience: "Voters",
    confirmLabel: (ctx) => (ctx.isAdmin ? "Submit vote" : hub.demo_mode ? "Submit" : "Submit for review"),
  },
  liveUrl: (id) => `/process/${id}`,
};
