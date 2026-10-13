// Conversation (deliberation) drafting form — mounted inside DraftShell by
// the ConversationDraft page. Same skeleton as VoteDraftingForm: the topic
// maps to the generic "title" field and the framing to "description" (the
// draft-title / draft-description input ids are what Apply-suggestion
// targets). Seed statements, duration, and the participant goal are plain
// form fields outside the assistant's reach.

import { useCallback } from "react";
import type { AssistantFieldGuidance, DeliberationDraft, ProposedLink } from "../services/api";
import ProcessLinkField from "./ProcessLinkField";
import "./DraftingForm.css";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";
import { hardFindings } from "./CocFindings";
import DraftFooter from "./DraftFooter";
import { useDebouncedFields } from "../hooks/useDebouncedFields";
import SuggestFooterButton from "./SuggestFooterButton";
import TitleField from "./TitleField";
import MarkdownTextarea from "./MarkdownTextarea";
import SeedStatementRows from "./SeedStatementRows";

interface Props {
  draft: DeliberationDraft;
  /** Related processes the author has picked. Optional by design — the
   *  field defaults empty and staying empty is a valid answer. */
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  /** When editing a published process: its id, kept out of the link picker. */
  linkSelfId?: string;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onThresholdChange: (n: number | null) => void;
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

const PLACEHOLDERS = {
  title: "e.g., How should we balance growth and rural character?",
  description:
    "Set the table for participants — what's the situation, why now, and what range of views exist?",
  sources:
    "Short title: https://… (one per line, up to six, optional)",
  seeds:
    "e.g. I'd use a bike lane on Main Street if it existed",
};

/** Why the draft can't be submitted yet, or null. */
function missingReason(draft: DeliberationDraft): string | null {
  if (!draft.title.trim()) return "Add a topic to submit.";
  if (!draft.description.trim()) return "Add the framing to submit.";
  return null;
}

export default function DeliberationDraftingForm({
  draft,
  links,
  onLinksChange,
  linkSelfId,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onDurationChange,
  onThresholdChange,
  onSubmit,
  onGetSuggestions,
  suggesting,
  disabled,
  fieldGuidance,
}: Props) {
  const { handleChange, schedule, flush } = useDebouncedFields(onFieldChange);

  // Seed statements arrive as a value, not an event: the rows component owns
  // its inputs and hands up the joined string.
  const handleSeedChange = useCallback(
    (value: string) => schedule("seed_statements", () => onFieldChange("seed_statements", value)),
    [schedule, onFieldChange],
  );

  return (
    <div className="drafting-form">
      <div className="drafting-form-scroll">
        <div className="form-field">
          <label htmlFor="draft-title" className="form-label">
            Topic <span className="required">*</span>
          </label>
          <TitleField
            id="draft-title"
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

        <ProcessLinkField
          value={links}
          onChange={onLinksChange}
          titles={linkTitles}
          onTitlesChange={onLinkTitlesChange}
          seedTitle={draft.title}
          seedDescription={draft.description}
          processType="civic.polis_deliberation"
          selfId={linkSelfId}
          disabled={disabled}
        />

        <div className="form-field">
          <label
            id="draft-seed_statements-label"
            htmlFor="draft-seed_statements"
            className="form-label"
          >
            Seed statements <span className="optional">(optional)</span>
          </label>
          {/* Numbered rows over the same newline-joined string the field has
              always stored. One row = one statement was the whole contract
              of this field and a plain textarea could not show it — a creator
              could not see where one statement ended, or that two were the
              same. A repeat is not cosmetic: Polis rejects it, and before
              2026-09-04 that aborted the conversation's start entirely. */}
          <SeedStatementRows
            id="draft-seed_statements"
            labelledBy="draft-seed_statements-label"
            value={draft.seed_statements}
            onChange={handleSeedChange}
            placeholder={PLACEHOLDERS.seeds}
            disabled={disabled}
          />
          <FieldGuide guidance={fieldGuidance} field="seed_statements" />
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
              schedule("threshold", () => {
                const n = parseInt(raw, 10);
                onThresholdChange(Number.isInteger(n) && n > 0 ? n : null);
              });
            }}
            disabled={disabled}
          />
          <p className="field-guide">
            Reaching the goal wraps the conversation up early.
          </p>
        </div>
      </div>

      <DraftFooter
        missing={missingReason(draft)}
        flagged={hardFindings(draft.last_review_result).length}
        onSubmit={() => {
          flush();
          onSubmit();
        }}
        submitLabel="Submit conversation"
        disabled={disabled}
        secondary={
          <SuggestFooterButton onGetSuggestions={onGetSuggestions} suggesting={suggesting} disabled={disabled} />
        }
      />
    </div>
  );
}
