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

import { useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AssistantPanel, { type ChatMessage } from "./AssistantPanel";
import SuggestionCard from "./SuggestionCard";
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
}

interface Props {
  backTo: string;
  backLabel: string;
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
  children: ReactNode;
}

const COC_DISCLOSURE =
  "All submissions get an automated check against the Code of Conduct before posting.";

export default function DraftShell({
  backTo,
  backLabel,
  title,
  error,
  reviewNotice,
  assistant,
  reviewSuggestions,
  onApplySuggestion,
  canApplySuggestion,
  layout = "full",
  children,
}: Props) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const footerHeight = useFooterHeight(isMobile);

  // The persistent opt-out: respected everywhere the affordance renders.
  const optedOut = user?.hide_ai_drafting_help === true;
  const showAssistant = assistant !== null && !optedOut;
  const open = showAssistant && assistant.open;

  const affordance = showAssistant && !open && (
    <div className="assistant-affordance">
      <div className="assistant-affordance-text">
        <span className="assistant-affordance-label">Want help drafting?</span>{" "}
        The assistant can ask a few questions and write a draft with you.
      </div>
      <button
        type="button"
        className="assistant-affordance-btn"
        onClick={assistant.onOpenRequest}
        disabled={assistant.opening}
      >
        {assistant.opening ? "Opening…" : "Open the assistant"}
      </button>
    </div>
  );

  const panel = showAssistant && (
    <AssistantPanel
      messages={assistant.messages}
      onSendMessage={assistant.onSendMessage}
      onApplySuggestion={onApplySuggestion}
      canApplySuggestion={canApplySuggestion}
      loading={assistant.loading}
      phase={assistant.phase}
      loadingLabel={assistant.loadingLabel}
      onClose={assistant.onClose}
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
            onApply={
              s.suggested_revision &&
              onApplySuggestion &&
              (canApplySuggestion ? canApplySuggestion(s) : true)
                ? () => onApplySuggestion(s)
                : undefined
            }
          />
        ))}
      </div>
    );

  const header = (
    <>
      <Link to={backTo} className="back-link">
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
            {notices}
            {/* Same collapsed card as desktop — the "?" bubble alone was not
                recognizable as the assistant on a phone (Adam, 2026-09-02). */}
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
        {isMobile && !open && (
          <button
            type="button"
            className="assistant-fab"
            // Sits just above the pinned status/submit footer, never over it.
            style={{ bottom: `calc(${footerHeight}px + var(--space-md))` }}
            onClick={assistant.onOpenRequest}
            aria-label="Open drafting assistant"
            disabled={assistant.opening}
          >
            <span aria-hidden="true">✦</span> {assistant.opening ? "Opening…" : "Assistant"}
          </button>
        )}
        {open && <div className="assistant-overlay">{panel}</div>}
      </>
    );
  }
}

/**
 * Height of the form's pinned footer (status + submit) on phones, so the
 * floating assistant button can sit above it. Observed, not assumed: the
 * footer grows when the Code of Conduct button appears.
 */
function useFooterHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) { setHeight(0); return; }
    const el = document.querySelector<HTMLElement>(".drafting-form-footer");
    if (!el) return;
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return height;
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
