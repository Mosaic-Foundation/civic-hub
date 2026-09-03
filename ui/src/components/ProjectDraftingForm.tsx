import { useCallback, useRef } from "react";
import type { AssistantFieldGuidance, ProjectDraft, DraftSuggestion } from "../services/api";
import { uploadProjectImage } from "../services/api";
import PostImagePicker from "./PostImagePicker";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";
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
  draft: ProjectDraft;
  onFieldChange: (field: string, value: string) => void;
  onImageChange: (next: { image_url: string | null; image_alt: string | null }) => void;
  onReview: () => void;
  onSubmit: () => void;
  disabled: boolean;
  reviewLoading?: boolean;
  /** Per-field inline guidance served by the assistant config endpoint. */
  fieldGuidance?: AssistantFieldGuidance[];
}

const PLACEHOLDERS = {
  title: "e.g., Community garden at the old rec center lot",
  description:
    "What are you building or organizing? Who would it serve? What do you need to make it happen?",
  sources: "Links to relevant information, examples, or resources (one per line, optional)",
};

function getStatusText(draft: ProjectDraft): string {
  if (!draft.title.trim()) {
    return "Status: Title is required";
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

function getStatusClass(draft: ProjectDraft): string {
  if (!draft.title.trim()) return "status-missing";
  if (draft.last_review_result === null) return "status-pending";
  if (draft.draft_modified_since_review) return "status-modified";
  const hasHard = (draft.last_review_result ?? []).some(
    (s: DraftSuggestion) => s.severity === "hard",
  );
  if (hasHard) return "status-blocked";
  return "status-ready";
}

export default function ProjectDraftingForm({
  draft,
  links,
  onLinksChange,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onImageChange,
  onReview,
  onSubmit,
  disabled,
  reviewLoading,
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
    draft.last_review_result !== null &&
    !draft.draft_modified_since_review &&
    !(draft.last_review_result ?? []).some((s: DraftSuggestion) => s.severity === "hard") &&
    !disabled;

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Project name <span className="required">*</span>
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
            Description <span className="optional">(optional)</span>
          </label>
          <MarkdownTextarea
            id="draft-description"
            className="form-textarea"
            defaultValue={draft.description}
            onChange={handleChange("description")}
            placeholder={PLACEHOLDERS.description}
            rows={6}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="description" />
        </div>

        <div className="form-field">
          <label className="form-label">
            Banner image <span className="optional">(optional)</span>
          </label>
          <p className="form-hint" style={{ marginBottom: "var(--space-sm)" }}>
            Adding a banner image helps your project stand out in the listing.
          </p>
          <PostImagePicker
            imageUrl={draft.banner_image_url}
            imageAlt={draft.banner_image_alt}
            onChange={onImageChange}
            disabled={disabled}
            uploadFn={uploadProjectImage}
          />
        </div>

        <div className="form-field">
          <label htmlFor="draft-sources" className="form-label">
            Links / Resources <span className="optional">(optional)</span>
          </label>
          <textarea
            id="draft-sources"
            className="form-textarea form-textarea-small"
            defaultValue={draft.sources}
            onChange={handleChange("sources")}
            placeholder={PLACEHOLDERS.sources}
            rows={4}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="sources" />
          <p className="form-hint">Add relevant links, one per line.</p>
        </div>

        <ProcessLinkField
          value={links}
          onChange={onLinksChange}
          titles={linkTitles}
          onTitlesChange={onLinkTitlesChange}
          seedTitle={draft.title}
          seedDescription={draft.description}
          processType="civic.project"
          disabled={disabled}
        />
      </div>

      <div className="drafting-form-footer">
        <div className={`draft-status ${getStatusClass(draft)}`}>
          {getStatusText(draft)}
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
            Submit project
          </button>
        </div>
      </div>
    </div>
  );
}
