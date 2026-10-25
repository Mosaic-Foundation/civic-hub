import { useState, useEffect } from "react";
import type { AssistantFieldGuidance, VoteDraft } from "../services/api";
import "./DraftingForm.css";
import "./VoteDraftingForm.css";
import { FieldGuide } from "./DraftingForm";
import { FieldFinding } from "./CocFindings";
import { hardFindings } from "./cocFindingsState";
import DraftFooter from "./DraftFooter";
import { useDebouncedFields } from "../hooks/useDebouncedFields";
import SuggestFooterButton from "./SuggestFooterButton";
import TitleField from "./TitleField";
import GrowingLineInput from "./GrowingLineInput";
import { filledOptions, VOTE_OPTION_MAX } from "../../../src/shared/voteOptions";
import ProcessLinkField from "./ProcessLinkField";
import type { ProposedLink, VoteDurationLimits } from "../services/api";
import MarkdownTextarea from "./MarkdownTextarea";

interface Props {
  /** Related processes the author has picked. Optional by design — the
   *  field defaults empty and staying empty is a valid answer. */
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  /** When editing a published process: its id, kept out of the link picker. */
  linkSelfId?: string;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  draft: VoteDraft;
  /** The hub's allowed voting windows; the standard choices until loaded. */
  durationLimits?: VoteDurationLimits | null;
  onFieldChange: (field: string, value: string) => void;
  onDurationChange: (ms: number) => void;
  onMethodChange: (method: string, options: string[] | null) => void;
  onSubmit: () => void;
  /** shellAssistant.onSuggest — a footer echo of the top affordance's Get
   *  suggestions, so a mobile creator who scrolls to the bottom still finds it. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
  /** Per-field inline guidance served by the assistant config endpoint. */
  fieldGuidance?: AssistantFieldGuidance[];
  disabled: boolean;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The standard choices that fall inside the hub's range, plus the range's
 * ends, its default and the draft's current value when those are not already
 * a standard choice — so every value the server accepts can be picked and the
 * current one is always shown.
 */
function durationOptions(limits: VoteDurationLimits | null | undefined, currentMs: number) {
  if (!limits) return DURATION_OPTIONS;
  const inRange = (ms: number) => ms >= limits.min_days * DAY_MS && ms <= limits.max_days * DAY_MS;
  const byMs = new Map(DURATION_OPTIONS.filter((o) => inRange(o.ms)).map((o) => [o.ms, o.label]));
  for (const days of [limits.min_days, limits.default_days, limits.max_days]) {
    if (!byMs.has(days * DAY_MS)) byMs.set(days * DAY_MS, `${days} days`);
  }
  if (inRange(currentMs) && !byMs.has(currentMs)) {
    byMs.set(currentMs, `${Math.round(currentMs / DAY_MS)} days`);
  }
  return [...byMs.entries()].sort((a, b) => a[0] - b[0]).map(([ms, label]) => ({ ms, label }));
}

const METHOD_OPTIONS = [
  { key: "yes_no_unsure", label: "Yes / No / Unsure" },
  { key: "approval", label: "Approval (pick from options)" },
];

const PLACEHOLDERS = {
  title: "e.g., Should we add sidewalks on Main Street between First and Third?",
  description:
    "Give voters the context they need — what's the current situation, who's affected, and why this matters.",
  sources: "Links to relevant information, one per line (optional)",
};

/** Why the draft can't be submitted yet, or null. */
/** The two receipt-check modes, as a vote's creator chooses (src/shared/checkMode.ts). */
const CHECK_MODE_CHOICES = [
  {
    key: "show_choice",
    title: "Show the choice",
    hint: "Anyone with a receipt code can check that the ballot was counted, and for which option. Voters are told to keep their code private.",
  },
  {
    key: "counted_only",
    title: "Counted only",
    hint: "A receipt code shows only that the ballot was counted, never how it was cast.",
  },
] as const;

function missingReason(draft: VoteDraft): string | null {
  if (!draft.title.trim()) return "Add a vote question to submit.";
  if (draft.method === "approval") {
    // Blank fields are ignored at Submit (an extra "+ Add option" left empty
    // never blocks it); two filled ones are needed.
    const opts = filledOptions(draft.custom_options ?? []);
    if (opts.length < 2) return "Approval voting needs at least 2 options.";
    if (opts.some((o) => o.length > VOTE_OPTION_MAX)) return `Shorten each option to ${VOTE_OPTION_MAX} characters or fewer.`;
  }
  return null;
}

export default function VoteDraftingForm({
  draft,
  durationLimits,
  links,
  onLinksChange,
  linkSelfId,
  linkTitles,
  onLinkTitlesChange,
  onFieldChange,
  onDurationChange,
  onMethodChange,
  onSubmit,
  onGetSuggestions,
  suggesting,
  disabled,
  fieldGuidance,
}: Props) {
  const { handleChange, schedule, flush } = useDebouncedFields(onFieldChange);
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
    schedule("custom_options", () => onMethodChange(draft.method, updated));
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
              ? "e.g., Which improvements should we prioritize for Main Street?"
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
              <span className="form-label-note"> (at least 2, up to {VOTE_OPTION_MAX} characters each)</span>
            </label>
            <div className="approval-options-editor">
              {localOptions.map((opt, i) => (
                <div key={i} className="approval-option-row">
                  <GrowingLineInput
                    className="form-input approval-option-input"
                    value={opt}
                    onChange={(v) => handleOptionChange(i, v)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={VOTE_OPTION_MAX}
                    disabled={disabled}
                    aria-label={`Option ${i + 1}`}
                  />
                  {/* Near the limit, say how near; an older draft over it says to shorten. */}
                  {opt.length >= VOTE_OPTION_MAX - 15 && (
                    <span
                      className={`approval-option-counter${opt.length > VOTE_OPTION_MAX ? " is-over" : ""}`}
                      aria-live="polite"
                    >
                      {opt.length} / {VOTE_OPTION_MAX}
                    </span>
                  )}
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
            <FieldFinding field="options" />
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
            {durationOptions(durationLimits, draft.voting_duration_ms).map((opt) => (
              <option key={opt.ms} value={opt.ms}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* How a receipt check answers once the vote closes (Actions slice). */}
        <fieldset className="form-field check-mode-field">
          <legend className="form-label">After the vote closes, what does a receipt code show?</legend>
          {CHECK_MODE_CHOICES.map((m) => (
            <label key={m.key} className="check-mode-choice">
              <input
                type="radio"
                name="check-mode"
                value={m.key}
                checked={(draft.check_mode ?? "show_choice") === m.key}
                onChange={() => onFieldChange("check_mode", m.key)}
                disabled={disabled}
              />
              <span>
                <span className="check-mode-title">{m.title}</span>
                <span className="form-hint check-mode-hint">{m.hint}</span>
              </span>
            </label>
          ))}
          <p className="form-hint">This can't be changed once the vote is approved.</p>
        </fieldset>

        <ProcessLinkField
          value={links}
          onChange={onLinksChange}
          titles={linkTitles}
          onTitlesChange={onLinkTitlesChange}
          seedTitle={draft.title}
          seedDescription={draft.description}
          processType="civic.vote"
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
        submitLabel="Submit vote"
        disabled={disabled}
        secondary={
          <SuggestFooterButton onGetSuggestions={onGetSuggestions} suggesting={suggesting} disabled={disabled} />
        }
      />
    </div>
  );
}
