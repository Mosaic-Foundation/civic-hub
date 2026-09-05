import { useCallback, useRef } from "react";
import type { AssistantFieldGuidance, DraftCategory, ProposalDraft } from "../services/api";
import "./DraftingForm.css";
import ProcessLinkField from "./ProcessLinkField";
import type { ProposedLink } from "../services/api";
import MarkdownTextarea from "./MarkdownTextarea";
import SuggestFooterButton from "./SuggestFooterButton";

/** Inline hint + example under a field — the same best-practices content
 *  the assistant works from, so manual drafters get the quality lift too. */
export function FieldGuide({
  guidance,
  field,
}: {
  guidance?: AssistantFieldGuidance[];
  field: string;
}) {
  const entry = guidance?.find((g) => g.field === field);
  if (!entry) return null;
  return (
    <p className="field-guide">
      {entry.hint}
      {entry.example && (
        <>
          {" "}
          <span className="field-guide-example">Example: “{entry.example}”</span>
        </>
      )}
    </p>
  );
}

interface Props {
  /** Related processes the author has picked. Optional by design — the
   *  field defaults empty and staying empty is a valid answer. */
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  draft: ProposalDraft;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onReview: () => void;
  onSubmit: () => void;
  /** shellAssistant.onSuggest — a footer echo of the top affordance's Get
   *  suggestions, so a mobile creator who scrolls to the bottom still finds it. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
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

const PLACEHOLDERS: Record<string, Record<string, string>> = {
  idea: {
    title: "e.g., Start a community garden at the old rec center lot",
    description:
      "What would you like to see happen, and why does it matter to you?",
    sources: "Any relevant links (optional, one per line)",
  },
  concern: {
    title: "e.g., Traffic speed on Route 8 near the school",
    description:
      "Describe the concern — what you've observed, who's affected, and what the community should consider.",
    sources: "Link to news articles, official documents, or data that support your concern (one per line)",
  },
};

function getPlaceholder(category: string | null, field: string): string {
  const cat = category ?? "idea";
  return PLACEHOLDERS[cat]?.[field] ?? PLACEHOLDERS["idea"]?.[field] ?? "";
}

function getStatusText(draft: ProposalDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim()) {
    return "Status: 1 required field missing";
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
    (s) => s.severity === "hard",
  );
  if (hardBlocks.length > 0) {
    return `Status: ${hardBlocks.length} Code of Conduct concern${hardBlocks.length > 1 ? "s" : ""} to resolve`;
  }

  return "Status: Ready to submit";
}

function getStatusClass(draft: ProposalDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim()) return "status-missing";
  if (draft.last_review_result === null && reviewFailed) return "status-error";
  if (draft.last_review_result === null) return "status-pending";
  if (draft.draft_modified_since_review) return "status-modified";
  const hasHard = (draft.last_review_result ?? []).some(
    (s) => s.severity === "hard",
  );
  if (hasHard) return "status-blocked";
  return "status-ready";
}

export default function DraftingForm({
  draft,
  links,
  onLinksChange,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onDurationChange,
  onReview,
  onSubmit,
  onGetSuggestions,
  suggesting,
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

  const handleSubTypeChange = useCallback(
    (cat: DraftCategory) => {
      onFieldChange("category", cat);
    },
    [onFieldChange],
  );

  const subType = draft.category ?? "idea";

  const canSubmit =
    draft.title.trim() &&
    draft.last_review_result !== null &&
    !draft.draft_modified_since_review &&
    !(draft.last_review_result ?? []).some((s) => s.severity === "hard") &&
    !disabled;

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="subtype-toggle">
          <button
            type="button"
            className={`subtype-pill${subType === "idea" ? " subtype-pill-active" : ""}`}
            onClick={() => handleSubTypeChange("idea")}
            disabled={disabled}
          >
            Idea
          </button>
          <button
            type="button"
            className={`subtype-pill${subType === "concern" ? " subtype-pill-active" : ""}`}
            onClick={() => handleSubTypeChange("concern")}
            disabled={disabled}
          >
            Concern
          </button>
        </div>

        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Title <span className="required">*</span>
          </label>
          <input
            id="draft-title"
            type="text"
            className="form-input"
            defaultValue={draft.title}
            onChange={handleChange("title")}
            placeholder={getPlaceholder(subType, "title")}
            maxLength={200}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="title" />
        </div>

        <div className="form-field">
          <label htmlFor="draft-description" className="form-label">
            Description <span className="optional">(optional)</span>
          </label>
          <MarkdownTextarea
            id="draft-description"
            className="form-textarea"
            defaultValue={draft.description}
            onChange={handleChange("description")}
            placeholder={getPlaceholder(subType, "description")}
            rows={5}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="description" />
        </div>

        <div className="form-field">
          <label htmlFor="draft-sources" className="form-label">
            Links / Sources <span className="optional">(optional)</span>
          </label>
          <textarea
            id="draft-sources"
            className="form-textarea form-textarea-small"
            defaultValue={draft.sources}
            onChange={handleChange("sources")}
            placeholder={getPlaceholder(subType, "sources")}
            rows={2}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="sources" />
          <p className="form-hint">Add relevant links, one per line.</p>
        </div>

        <div className="form-field">
          <label htmlFor="draft-duration" className="form-label">
            How long should this proposal stay open?
          </label>
          <select
            id="draft-duration"
            className="form-select"
            value={draft.proposal_duration_ms}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            disabled={disabled}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.ms} value={opt.ms}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <ProcessLinkField
          value={links}
          onChange={onLinksChange}
          titles={linkTitles}
          onTitlesChange={onLinkTitlesChange}
          seedTitle={draft.title}
          seedDescription={draft.description}
          processType="civic.proposal"
          disabled={disabled}
        />
      </div>

      <div className="drafting-form-footer">
        <SuggestFooterButton
          onGetSuggestions={onGetSuggestions}
          suggesting={suggesting}
          disabled={disabled}
        />
        <div className={`draft-status ${getStatusClass(draft, reviewFailed)}`}>
          {getStatusText(draft, reviewFailed)}
        </div>

        <div className="draft-actions">
          {draft.title.trim() && (draft.last_review_result === null || draft.draft_modified_since_review) && (
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
            Submit proposal
          </button>
        </div>
      </div>
    </div>
  );
}
