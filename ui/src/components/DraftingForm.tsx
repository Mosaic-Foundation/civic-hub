import { useCallback } from "react";
import type { AssistantFieldGuidance, DraftCategory, ProposalDraft } from "../services/api";
import "./DraftingForm.css";
import ProcessLinkField from "./ProcessLinkField";
import type { ProposedLink } from "../services/api";
import MarkdownTextarea from "./MarkdownTextarea";
import SuggestFooterButton from "./SuggestFooterButton";
import TitleField from "./TitleField";
import { FieldFinding, hardFindings } from "./CocFindings";
import DraftFooter from "./DraftFooter";
import { useDebouncedFields } from "../hooks/useDebouncedFields";

/** Under a field: what the Code of Conduct check flagged in it, if anything,
 *  then the inline hint + example — the same best-practices content the
 *  assistant works from, so manual drafters get the quality lift too. */
export function FieldGuide({
  guidance,
  field,
}: {
  guidance?: AssistantFieldGuidance[];
  field: string;
}) {
  const entry = guidance?.find((g) => g.field === field);
  return (
    <>
      <FieldFinding field={field} />
      {entry && <FieldHint entry={entry} />}
    </>
  );
}

function FieldHint({ entry }: { entry: AssistantFieldGuidance }) {
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
  /** When editing a published process: its id, kept out of the link picker. */
  linkSelfId?: string;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  draft: ProposalDraft;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onSubmit: () => void;
  /** shellAssistant.onSuggest — a footer echo of the top affordance's Get
   *  suggestions, so a mobile creator who scrolls to the bottom still finds it. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
  disabled: boolean;
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

/** Why the draft can't be submitted yet, or null. */
function missingReason(draft: ProposalDraft): string | null {
  return draft.title.trim() ? null : "Add a title to submit.";
}

export default function DraftingForm({
  draft,
  links,
  onLinksChange,
  linkSelfId,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onDurationChange,
  onSubmit,
  onGetSuggestions,
  suggesting,
  disabled,
  fieldGuidance,
}: Props) {
  const { handleChange, flush } = useDebouncedFields(onFieldChange);

  const handleSubTypeChange = useCallback(
    (cat: DraftCategory) => {
      onFieldChange("category", cat);
    },
    [onFieldChange],
  );

  const subType = draft.category ?? "idea";

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
          <TitleField
            id="draft-title"
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
        submitLabel="Submit proposal"
        disabled={disabled}
        secondary={
          <SuggestFooterButton onGetSuggestions={onGetSuggestions} suggesting={suggesting} disabled={disabled} />
        }
      />
    </div>
  );
}
