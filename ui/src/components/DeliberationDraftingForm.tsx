// Conversation (deliberation) drafting form — mounted inside DraftShell by
// the ConversationDraft page. Same skeleton as VoteDraftingForm: the topic
// maps to the generic "title" field and the framing to "description" (the
// draft-title / draft-description input ids are what Apply-suggestion
// targets). Seed statements, duration, and the participant goal are plain
// form fields outside the assistant's reach.

import { useCallback, useRef } from "react";
import type { AssistantFieldGuidance, DeliberationDraft, DraftSuggestion } from "../services/api";
import "./DraftingForm.css";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";

interface Props {
  draft: DeliberationDraft;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onThresholdChange: (n: number | null) => void;
  onReview: () => void;
  onSubmit: () => void;
  disabled: boolean;
  reviewLoading?: boolean;
  reviewFailed?: boolean;
  /** Per-field inline guidance served by the assistant config endpoint. */
  fieldGuidance?: AssistantFieldGuidance[];
}

// The unified duration picker — the same five choices on every
// duration-bearing type (votes, proposals, conversations), default 6 weeks.
const DURATION_OPTIONS = [
  { label: "2 weeks", ms: 14 * 24 * 60 * 60 * 1000 },
  { label: "1 month", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "6 weeks", ms: 42 * 24 * 60 * 60 * 1000 },
  { label: "2 months", ms: 60 * 24 * 60 * 60 * 1000 },
  { label: "3 months", ms: 90 * 24 * 60 * 60 * 1000 },
];

const PLACEHOLDERS = {
  title: "e.g., How should Floyd County balance growth and rural character?",
  description:
    "Set the table for participants — what's the situation, why now, and what range of views exist?",
  seeds:
    "Short, single-idea statements participants vote on first (one per line, optional)",
};

function getStatusText(draft: DeliberationDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim() || !draft.description.trim()) {
    const missing = [!draft.title.trim(), !draft.description.trim()].filter(Boolean).length;
    return `Status: ${missing} required field${missing > 1 ? "s" : ""} missing`;
  }
  if (draft.last_review_result === null && reviewFailed) {
    return "Status: Check failed — tap Run Code of Conduct check to try again";
  }
  if (draft.last_review_result === null) {
    return "Status: Run the Code of Conduct check to prepare for submission";
  }
  if (draft.draft_modified_since_review) {
    return "Status: Draft changed — run the Code of Conduct check again before submitting";
  }
  const hardBlocks = (draft.last_review_result ?? []).filter(
    (s: DraftSuggestion) => s.severity === "hard",
  );
  if (hardBlocks.length > 0) {
    return `Status: ${hardBlocks.length} Code of Conduct concern${hardBlocks.length > 1 ? "s" : ""} to resolve`;
  }
  return "Status: Ready to submit";
}

function getStatusClass(draft: DeliberationDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim() || !draft.description.trim()) return "status-missing";
  if (draft.last_review_result === null && reviewFailed) return "status-error";
  if (draft.last_review_result === null) return "status-pending";
  if (draft.draft_modified_since_review) return "status-modified";
  const hasHard = (draft.last_review_result ?? []).some(
    (s: DraftSuggestion) => s.severity === "hard",
  );
  if (hasHard) return "status-blocked";
  return "status-ready";
}

export default function DeliberationDraftingForm({
  draft,
  onFieldChange,
  onDurationChange,
  onThresholdChange,
  onReview,
  onSubmit,
  disabled,
  reviewLoading,
  reviewFailed,
  fieldGuidance,
}: Props) {
  // Per-FIELD debounce timers: a single shared timer silently dropped a
  // field's save when the user moved to another field within 800ms —
  // the form kept the text but the server never received it.
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback(
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (debounceRef.current[field]) clearTimeout(debounceRef.current[field]);
      debounceRef.current[field] = setTimeout(() => {
        onFieldChange(field, value);
      }, 800);
    },
    [onFieldChange],
  );

  const canSubmit =
    draft.title.trim() &&
    draft.description.trim() &&
    draft.last_review_result !== null &&
    !draft.draft_modified_since_review &&
    !(draft.last_review_result ?? []).some((s: DraftSuggestion) => s.severity === "hard") &&
    !disabled;

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Topic <span className="required">*</span>
          </label>
          <input
            id="draft-title"
            type="text"
            className="form-input"
            defaultValue={draft.title}
            onChange={handleChange("title")}
            placeholder={PLACEHOLDERS.title}
            maxLength={200}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="title" />
        </div>

        <div className="form-field">
          <label htmlFor="draft-description" className="form-label">
            Framing <span className="required">*</span>
          </label>
          <textarea
            id="draft-description"
            className="form-textarea"
            defaultValue={draft.description}
            onChange={handleChange("description")}
            placeholder={PLACEHOLDERS.description}
            rows={5}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="description" />
        </div>

        <div className="form-field">
          <label htmlFor="draft-seeds" className="form-label">
            Seed statements <span className="optional">(optional)</span>
          </label>
          <textarea
            id="draft-seeds"
            className="form-textarea form-textarea-small"
            defaultValue={draft.seed_statements}
            onChange={handleChange("seed_statements")}
            placeholder={PLACEHOLDERS.seeds}
            rows={3}
            disabled={disabled}
          />
          <p className="field-guide">
            Keep each statement short and single-idea, and represent different
            perspectives — including ones you don't share.{" "}
            <span className="field-guide-example">
              Example: “I'd use a bike lane on Main Street if it existed”
            </span>
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="draft-duration" className="form-label">
            How long should the conversation stay open?
          </label>
          <select
            id="draft-duration"
            className="form-select"
            value={draft.duration_ms}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            disabled={disabled}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.ms} value={opt.ms}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="field-guide">
            The clock starts when the conversation opens, not when you submit.
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="draft-threshold" className="form-label">
            Participant goal <span className="optional">(optional)</span>
          </label>
          <input
            id="draft-threshold"
            type="number"
            className="form-input"
            defaultValue={draft.participation_threshold ?? ""}
            min={1}
            placeholder="e.g. 50"
            onChange={(e) => {
              const raw = e.target.value;
              if (debounceRef.current["threshold"]) {
                clearTimeout(debounceRef.current["threshold"]);
              }
              debounceRef.current["threshold"] = setTimeout(() => {
                const n = parseInt(raw, 10);
                onThresholdChange(Number.isInteger(n) && n > 0 ? n : null);
              }, 800);
            }}
            disabled={disabled}
          />
          <p className="field-guide">
            Reaching the goal wraps the conversation up early.
          </p>
        </div>
      </div>

      <div className="drafting-form-footer">
        <div className={`draft-status ${getStatusClass(draft, reviewFailed)}`}>
          {getStatusText(draft, reviewFailed)}
        </div>

        <div className="draft-actions">
          {draft.title.trim() && draft.description.trim() &&
            (draft.last_review_result === null || draft.draft_modified_since_review) && (
            <button
              type="button"
              className="draft-review-btn"
              onClick={onReview}
              disabled={disabled || reviewLoading}
            >
              {reviewLoading ? "Checking..." : "Run Code of Conduct check"}
            </button>
          )}
          <button
            type="button"
            className="draft-submit-btn"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            Submit conversation
          </button>
        </div>
      </div>
    </div>
  );
}
