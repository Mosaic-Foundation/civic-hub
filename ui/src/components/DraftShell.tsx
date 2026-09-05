// DraftShell — the ONE creation layout every process type mounts.
//
// Form-first: the drafting form is the page and is fully usable on its own.
// AI writing help is progressive disclosure, never a path choice and never
// auto-open: a visible-but-collapsed affordance (desktop card / mobile FAB)
// that the user must click to open. The shell also renders the universal
// Code of Conduct disclosure line, the inline CoC-check results (so manual
// drafters see and resolve concerns without the assistant), and hides the
// assistant affordance entirely when the signed-in user has "Hide AI
// drafting help" set or the process type declares no assistant config.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { friendlyType } from "./ProcessLinkPicker";
import AssistantPanel, { type ChatMessage } from "./AssistantPanel";
import SuggestionCard, { suggestionKey } from "./SuggestionCard";
import type { DraftSuggestion } from "../services/api";
import "./DraftShell.css";

export interface DraftShellAssistant {
  open: boolean;
  opening: boolean;
  messages: ChatMessage[];
  loading: boolean;
  phase: "brainstorm" | "free_form" | "review";
  loadingLabel?: string;
  /** User clicked the affordance/FAB — the owner runs the auth gate +
   *  draft creation + greeting, then flips `open`. */
  onOpenRequest: () => void;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  /** "Get suggestions": review the current draft against best practices
   *  and show the cards in the assistant panel. */
  onSuggest?: () => void;
  suggesting?: boolean;
  /** Deterministic empty-field help offers — chips the panel shows after the
   *  opening flow, one per field this form still has blank. */
  fieldHelp?: Array<{ field: string; label: string; prompt: string }>;
}

interface Props {
  backTo: string;
  backLabel: string;
  /** Render the back link as a solid navy button (edit mode's "Cancel editing"). */
  backAsButton?: boolean;
  title: string;
  error?: string | null;
  reviewNotice?: string | null;
  /** null → no assistant affordance at all. The shell additionally hides
   *  it when the signed-in user has hide_ai_drafting_help set. */
  assistant: DraftShellAssistant | null;
  /** Latest CoC-check results — rendered inline while the assistant panel
   *  is closed, so the manual path can see and resolve them. */
  reviewSuggestions?: DraftSuggestion[] | null;
  /** Applies assistant-produced text into the form (marks assistant_helped).
   *  Used by both the inline results block and the panel's cards. */
  onApplySuggestion?: (s: DraftSuggestion) => void;
  /** Gates Apply per card — suggestions for fields this form doesn't have
   *  must not offer a silent no-op Apply button. */
  canApplySuggestion?: (s: DraftSuggestion) => boolean;
  /**
   * "full": fixed-height two-pane layout for forms with internal scroll
   * (proposal / vote / project). "page": normal page flow (conversation).
   */
  layout?: "full" | "page";
  /** Registry type — names the form tab ("Conversation form") and the
   *  assistant's placeholder. */
  processType?: string;
  /** A value that changes whenever the draft's fields change (its
   *  updated_at). While the assistant view is up, a change marks the form
   *  tab "updated" so the person knows there is something to look at. */
  formVersion?: string | null;
  children: ReactNode;
}

const COC_DISCLOSURE =
  "All submissions get an automated check against the Code of Conduct before posting.";

export default function DraftShell({
  backTo,
  backLabel,
  backAsButton = false,
  title,
  error,
  reviewNotice,
  assistant,
  reviewSuggestions,
  onApplySuggestion,
  canApplySuggestion,
  layout = "full",
  processType,
  formVersion,
  children,
}: Props) {
  const { user } = useAuth();
  /**
   * Which suggestions have been applied. Owned HERE, not in the panel and not
   * in the card: the card unmounts on every form/assistant switch (Adam,
   * 2026-09-04, applied cards came back reading "Apply"), and the panel
   * unmounts with it. DraftShell is mounted for the whole drafting session on
   * both layouts, and every drafting page must render it — so every process
   * type, present and future, gets this with nothing to wire up.
   */
  const [appliedKeys, setAppliedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const markApplied = (s: DraftSuggestion) =>
    setAppliedKeys((prev) => {
      const key = suggestionKey(s);
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  const isMobile = useIsMobile();
  const typeLabel = processType ? friendlyType(processType) : "Draft";

  // The persistent opt-out: respected everywhere the affordance renders.
  const optedOut = user?.hide_ai_drafting_help === true;
  const showAssistant = assistant !== null && !optedOut;
  const open = showAssistant && assistant.open;

  // "Updated" marker on the form tab: the draft changed while the assistant
  // view was up (the assistant wrote a draft, or Apply was pressed).
  const versionAtOpen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (open) versionAtOpen.current = formVersion;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const formUpdated =
    open && versionAtOpen.current !== undefined && versionAtOpen.current !== formVersion;

  /**
   * Phone navigation between the two views (Adam, 2026-09-02: the assistant
   * covered the form and the only way back was the ×). Rendered at the top
   * of the form page and as the assistant view's header, so the same control
   * is in the same place in both.
   */
  const switcher = showAssistant && isMobile ? (
    <div className="draft-view-switch" role="tablist" aria-label="Draft view">
      <button
        type="button"
        role="tab"
        aria-selected={!open}
        className={`draft-view-tab${!open ? " is-active" : ""}`}
        onClick={() => { if (open) assistant.onClose(); }}
      >
        {typeLabel} form
        {formUpdated && <span className="draft-view-dot" aria-label="Updated" />}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={open}
        className={`draft-view-tab${open ? " is-active" : ""}`}
        onClick={() => { if (!open) assistant.onOpenRequest(); }}
        disabled={assistant.opening}
      >
        {assistant.opening && !open ? "Opening…" : "Assistant"}
      </button>
    </div>
  ) : null;

  const affordance = showAssistant && !open && (
    <div className="assistant-affordance">
      <div className="assistant-affordance-text">
        <span className="assistant-affordance-label">Want help drafting?</span>{" "}
        {assistant.onSuggest
          ? "The assistant can ask a few questions and write a draft with you — or review what you have and suggest improvements."
          : "The assistant can ask a few questions and write a draft with you. Once you've written something, it can review that too."}
      </div>
      <div className="assistant-affordance-actions">
        <button
          type="button"
          className="assistant-affordance-btn"
          onClick={assistant.onOpenRequest}
          disabled={assistant.opening || assistant.suggesting}
        >
          {assistant.opening ? "Opening…" : "Open the assistant"}
        </button>
        {assistant.onSuggest && (
          <button
            type="button"
            className="assistant-affordance-btn assistant-affordance-btn--secondary"
            onClick={assistant.onSuggest}
            disabled={assistant.opening || assistant.suggesting}
            title="Review the current draft against the best-practices guide and suggest improvements"
          >
            {assistant.suggesting ? "Reviewing…" : "Get suggestions"}
          </button>
        )}
      </div>
    </div>
  );

  const panel = showAssistant && (
    <AssistantPanel
      messages={assistant.messages}
      onSendMessage={assistant.onSendMessage}
      onApplySuggestion={onApplySuggestion}
      appliedSuggestions={appliedKeys}
      onSuggestionApplied={markApplied}
      canApplySuggestion={canApplySuggestion}
      loading={assistant.loading}
      phase={assistant.phase}
      loadingLabel={assistant.loadingLabel}
      onClose={assistant.onClose}
      header={isMobile ? switcher : undefined}
      placeholder={`Ask for help with your ${typeLabel.toLowerCase()}...`}
      onDone={assistant.onClose}
      doneLabel={`Done — back to the ${typeLabel.toLowerCase()} form`}
      fieldHelp={assistant.fieldHelp}
      onFieldHelp={assistant.onSendMessage}
    />
  );

  // Inline CoC results for the manual path — hidden while the panel is
  // open (the same suggestions render as chat cards there).
  const inlineResults = !open &&
    reviewSuggestions &&
    reviewSuggestions.length > 0 && (
      <div className="coc-results">
        <h3 className="coc-results-title">Code of Conduct check</h3>
        {reviewSuggestions.map((s, i) => (
          <SuggestionCard
            key={i}
            suggestion={s}
            applied={appliedKeys.has(suggestionKey(s))}
            onApply={
              s.suggested_revision &&
              onApplySuggestion &&
              (canApplySuggestion ? canApplySuggestion(s) : true)
                ? (revision: string) => {
                    onApplySuggestion({ ...s, suggested_revision: revision });
                    markApplied(s);
                  }
                : undefined
            }
          />
        ))}
      </div>
    );

  const header = (
    <>
      <Link to={backTo} className={`back-link${backAsButton ? " back-link--button" : ""}`}>
        &larr; {backLabel}
      </Link>
      <h1 className="propose-draft-title">{title}</h1>
      <p className="coc-disclosure">{COC_DISCLOSURE}</p>
    </>
  );

  const notices = (
    <>
      {error && <p className="form-error">{error}</p>}
      {reviewNotice && <p className="form-hint">{reviewNotice}</p>}
    </>
  );

  if (layout === "page") {
    return (
      <div className="page detail-page">
        <div className="draft-shell-page-header">{header}</div>
        {notices}
        {!isMobile && affordance}
        {inlineResults}
        {children}
        {renderFloatingAssistant()}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="propose-draft-page">
        <div className="propose-draft-mobile">
          <div className="page detail-page">
            <div className="draft-shell-page-header">{header}</div>
            {switcher}
            {notices}
            {/* Same collapsed card as desktop — explains what the assistant
                does; the switcher above is the persistent way to it. */}
            {affordance}
            {inlineResults}
            {children}
          </div>
        </div>
        {renderFloatingAssistant()}
      </div>
    );
  }

  // Desktop: two-pane grid only while the panel is open; otherwise the
  // form takes the full width with the collapsed affordance card above it.
  return (
    <div className="propose-draft-page">
      <div className={open ? "propose-draft-layout" : "propose-draft-layout draft-shell-solo"}>
        {open && <div className="propose-draft-assistant">{panel}</div>}
        <div className="propose-draft-form">
          <div className="propose-draft-form-header">{header}</div>
          <div className="draft-shell-notices">{notices}</div>
          {affordance}
          {inlineResults}
          {children}
        </div>
      </div>
    </div>
  );

  // Mobile FAB + overlay; the overlay also serves a desktop "page" layout
  // (no fixed two-pane grid to dock a panel into).
  function renderFloatingAssistant() {
    if (!showAssistant) return null;
    if (!isMobile && layout === "full") return null;
    return (
      <>
        {open && <div className="assistant-overlay">{panel}</div>}
      </>
    );
  }
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 769 : false,
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 769);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
}
