import type { AssistantFieldGuidance, ProjectDraft } from "../services/api";
import { uploadProjectImage } from "../services/api";
import PostImagePicker from "./PostImagePicker";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";
import { hardFindings } from "./cocFindingsState";
import DraftFooter from "./DraftFooter";
import { useDebouncedFields } from "../hooks/useDebouncedFields";
import SuggestFooterButton from "./SuggestFooterButton";
import TitleField from "./TitleField";
import ProcessLinkField from "./ProcessLinkField";
import type { ProposedLink } from "../services/api";
import MarkdownTextarea from "./MarkdownTextarea";
import { useHub } from "../config/hub";

interface Props {
  /** Related processes the author has picked. Optional by design — the
   *  field defaults empty and staying empty is a valid answer. */
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  /** When editing a published process: its id, kept out of the link picker. */
  linkSelfId?: string;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  draft: ProjectDraft;
  onFieldChange: (field: string, value: string) => void;
  onImageChange: (next: { image_url: string | null; image_alt: string | null }) => void;
  onSubmit: () => void;
  /** shellAssistant.onSuggest — a footer echo of the top affordance's Get
   *  suggestions, so a mobile creator who scrolls to the bottom still finds it. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
  disabled: boolean;
  /** Per-field inline guidance served by the assistant config endpoint. */
  fieldGuidance?: AssistantFieldGuidance[];
  /** Fields the edit policy locks (a supported project's title). */
  lockedFields?: string[];
  /** Live values to display for locked fields. */
  lockedValues?: { title?: string };
  /** Edit mode: a Cancel button beside Submit that discards the edit. */
  onCancel?: () => void;
  /** Edit mode: "Save changes" instead of "Submit project". */
  submitLabel?: string;
}

const PLACEHOLDERS = {
  title: "e.g., Community garden at the old rec center lot",
  description:
    "What are you building or organizing? Who would it serve? What do you need to make it happen?",
  sources: "Links to relevant information, examples, or resources (one per line, optional)",
};

/** Why the draft can't be submitted yet, or null. */
function missingReason(draft: ProjectDraft): string | null {
  return draft.title.trim() ? null : "Add a project name to submit.";
}

export default function ProjectDraftingForm({
  draft,
  links,
  onLinksChange,
  linkSelfId,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onImageChange,
  onSubmit,
  onGetSuggestions,
  suggesting,
  disabled,
  fieldGuidance,
  lockedFields = [],
  lockedValues,
  onCancel,
  submitLabel = "Submit project",
}: Props) {
  const hub = useHub();
  const titleLocked = lockedFields.includes("title");
  const { handleChange, flush } = useDebouncedFields(onFieldChange);

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Project name <span className="required">*</span>
          </label>
          {titleLocked ? (
            // Locked: show the LIVE title (the draft may carry a stale one)
            // as plain text — not a box that looks editable. The server
            // ignores title changes anyway.
            <p id="draft-title" className="form-locked-value" aria-describedby="draft-title-locked">
              {lockedValues?.title ?? draft.title}
            </p>
          ) : (
            <TitleField
              id="draft-title"
              defaultValue={draft.title}
              onChange={handleChange("title")}
              placeholder={PLACEHOLDERS.title}
              maxLength={200}
              disabled={disabled}
            />
          )}
          {titleLocked && (
            <p id="draft-title-locked" className="form-hint">
              The title is locked because {hub.noun(2)} have already supported this project under it.
            </p>
          )}
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
          selfId={linkSelfId}
          disabled={disabled}
        />
      </div>

      <DraftFooter
        missing={missingReason(draft)}
        flagged={hardFindings(draft.last_review_result).length}
        onSubmit={() => {
          flush();
          onSubmit();
        }}
        submitLabel={submitLabel}
        disabled={disabled}
        secondary={
          <>
            <SuggestFooterButton onGetSuggestions={onGetSuggestions} suggesting={suggesting} disabled={disabled} />
            {onCancel && (
              <button
                type="button"
                className="draft-cancel-btn"
                onClick={onCancel}
                disabled={disabled}
                title="Leave without saving. The project keeps its current text."
              >
                Cancel
              </button>
            )}
          </>
        }
      />
    </div>
  );
}
