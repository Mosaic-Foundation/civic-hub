import { useCallback, useRef, useState, useEffect } from "react";
import type { AssistantFieldGuidance, VoteDraft, DraftSuggestion } from "../services/api";
import "./DraftingForm.css";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";
import SuggestFooterButton from "./SuggestFooterButton";
import TitleField from "./TitleField";
import GrowingLineInput from "./GrowingLineInput";
import ProcessLinkField from "./ProcessLinkField";
import type { ProposedLink } from "../services/api";
import MarkdownTextarea from "./MarkdownTextarea";

interface Props {
  /** Related processes the author has picked. Optional by design — the
   *  field defaults empty and staying empty is a valid answer. */
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  draft: VoteDraft;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onMethodChange: (method: string, options: string[] | null) => void;
  onReview: () => void;
  onSubmit: () => void;
  /** shellAssistant.onSuggest — a footer echo of the top affordance's Get
   *  suggestions, so a mobile creator who scrolls to the bottom still finds it. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
  /** Per-field inline guidance served by the assistant config endpoint. */
  fieldGuidance?: AssistantFieldGuidance[];
  disabled: boolean;
  reviewLoading?: boolean;
  reviewFailed?: boolean;
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

const METHOD_OPTIONS = [
  { key: "yes_no_unsure", label: "Yes / No / Unsure" },
  { key: "approval", label: "Approval (pick from options)" },
];

const PLACEHOLDERS = {
  title: "e.g., Should Floyd County add sidewalks on Main Street between First and Third?",
  description:
    "Give voters the context they need — what's the current situation, who's affected, and why this matters.",
  sources: "Links to relevant information, one per line (optional)",
};

function getStatusText(draft: VoteDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim()) {
    return "Status: Title is required";
  }

  if (draft.method === "approval") {
    const opts = draft.custom_options ?? [];
    if (opts.length < 2) {
      return "Status: At least 2 options are required for approval voting";
    }
    if (opts.some((o) => !o.trim())) {
      return "Status: All options must have text";
    }
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

function getStatusClass(draft: VoteDraft, reviewFailed?: boolean): string {
  if (!draft.title.trim()) return "status-missing";
  if (draft.method === "approval") {
    const opts = draft.custom_options ?? [];
    if (opts.length < 2 || opts.some((o) => !o.trim())) return "status-missing";
  }
  if (draft.last_review_result === null && reviewFailed) return "status-error";
  if (draft.last_review_result === null) return "status-pending";
  if (draft.draft_modified_since_review) return "status-modified";
  const hasHard = (draft.last_review_result ?? []).some(
    (s: DraftSuggestion) => s.severity === "hard",
  );
  if (hasHard) return "status-blocked";
  return "status-ready";
}

export default function VoteDraftingForm({
  draft,
  links,
  onLinksChange,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onDurationChange,
  onMethodChange,
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
  const [localOptions, setLocalOptions] = useState<string[]>(
    draft.custom_options ?? ["", ""],
  );

  // Adopt options that arrive from outside the editor — the assistant's
  // "options" card applied, or a resumed draft. Local state is the editing
  // truth, so only a genuinely different, non-empty set replaces it; the
  // debounced echo of the person's own typing matches local and is ignored.
  useEffect(() => {
    const incoming = (draft.custom_options ?? []).map((o) => o.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    const current = localOptions.map((o) => o.trim()).filter(Boolean);
    if (incoming.join("\n") !== current.join("\n")) setLocalOptions(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.custom_options]);

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

  function handleMethodSelect(method: string) {
    if (method === "approval") {
      const opts = localOptions.length >= 2 ? localOptions : ["", ""];
      setLocalOptions(opts);
      onMethodChange(method, opts);
    } else {
      onMethodChange(method, null);
    }
  }

  function handleOptionChange(index: number, value: string) {
    const updated = [...localOptions];
    updated[index] = value;
    setLocalOptions(updated);
    if (debounceRef.current["custom_options"]) {
      clearTimeout(debounceRef.current["custom_options"]);
    }
    debounceRef.current["custom_options"] = setTimeout(() => {
      onMethodChange(draft.method, updated);
    }, 800);
  }

  function addOption() {
    const updated = [...localOptions, ""];
    setLocalOptions(updated);
    onMethodChange(draft.method, updated);
  }

  function removeOption(index: number) {
    if (localOptions.length <= 2) return;
    const updated = localOptions.filter((_, i) => i !== index);
    setLocalOptions(updated);
    onMethodChange(draft.method, updated);
  }

  const approvalOptionsValid = draft.method !== "approval" ||
    ((draft.custom_options ?? []).length >= 2 &&
      (draft.custom_options ?? []).every((o) => o.trim()));

  const canSubmit =
    draft.title.trim() &&
    approvalOptionsValid &&
    draft.last_review_result !== null &&
    !draft.draft_modified_since_review &&
    !(draft.last_review_result ?? []).some((s: DraftSuggestion) => s.severity === "hard") &&
    !disabled;

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="form-field">
          <label className="form-label">
            Voting method
          </label>
          <div className="method-selector">
            {METHOD_OPTIONS.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`method-option ${draft.method === m.key ? "method-option-selected" : ""}`}
                onClick={() => handleMethodSelect(m.key)}
                disabled={disabled}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="form-hint">
            {draft.method === "approval"
              ? "Voters can approve any number of the options you define below."
              : "Voters choose Yes, No, or Unsure."}
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Vote question <span className="required">*</span>
          </label>
          <TitleField
            id="draft-title"
            defaultValue={draft.title}
            onChange={handleChange("title")}
            placeholder={draft.method === "approval"
              ? "e.g., Which improvements should Floyd County prioritize for Main Street?"
              : PLACEHOLDERS.title}
            maxLength={200}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="title" />
        </div>

        {draft.method === "approval" && (
          <div className="form-field">
            <label className="form-label">
              Options <span className="required">*</span>
              <span className="form-label-note"> (at least 2)</span>
            </label>
            <div className="approval-options-editor">
              {localOptions.map((opt, i) => (
                <div key={i} className="approval-option-row">
                  <GrowingLineInput
                    className="form-input approval-option-input"
                    value={opt}
                    onChange={(v) => handleOptionChange(i, v)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={200}
                    disabled={disabled}
                    aria-label={`Option ${i + 1}`}
                  />
                  {localOptions.length > 2 && (
                    <button
                      type="button"
                      className="approval-option-remove"
                      onClick={() => removeOption(i)}
                      disabled={disabled}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="approval-option-add"
                onClick={addOption}
                disabled={disabled}
              >
                + Add option
              </button>
            </div>
          </div>
        )}

        <div className="form-field">
          <label htmlFor="draft-description" className="form-label">
            Context for voters <span className="optional">(optional)</span>
          </label>
          <MarkdownTextarea
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
          <label htmlFor="draft-sources" className="form-label">
            Links / Sources <span className="optional">(optional)</span>
          </label>
          <textarea
            id="draft-sources"
            className="form-textarea form-textarea-small"
            defaultValue={draft.sources}
            onChange={handleChange("sources")}
            placeholder={PLACEHOLDERS.sources}
            rows={2}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="sources" />
          <p className="form-hint">Add relevant links, one per line.</p>
        </div>

        <div className="form-field">
          <label htmlFor="draft-duration" className="form-label">
            How long should voting stay open?
          </label>
          <select
            id="draft-duration"
            className="form-select"
            value={draft.voting_duration_ms}
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
          processType="civic.vote"
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
            Submit vote
          </button>
        </div>
      </div>
    </div>
  );
}
