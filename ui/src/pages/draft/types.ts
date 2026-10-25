// What one drafting kind tells DraftPage (Audit 3, F1): its draft's empty
// shape, its form, its shell's wording, what its confirmation says and where
// a submission lands. Everything else (the lazy draft, the assistant, links,
// the confirmation, submitting) is DraftPage's, once.
//
// The layout is DraftPage's too, so a new process type's form looks and
// behaves like the others on every screen (Submit and Save, 2026-10-12):
//   - a phone gets the focused drafting layout: one slim row (back, "New
//     <confirm.noun>", the saved note) instead of the hub header and section
//     tabs; the bar pinned at the bottom, one row, stepping aside while a
//     text field has focus;
//   - Submit runs the Code of Conduct check and shows findings under the
//     field they name.
// For a form to get all of it, build it from the shared pieces: put its
// fields inside `.drafting-form`, give each a FieldGuide (the hint and any
// finding), use MarkdownTextarea for long text (its toolbar docks above the
// keyboard), and end with DraftFooter. pages/draft/forms/ has four examples;
// tests/e2e/phoneDrafting.spec.ts lists the kinds it checks.

import type { ComponentType, ReactNode } from "react";
import type { BaseDraft, useDraftFlow } from "../../hooks/useDraftFlow";
import type { Hub } from "../../config/hub";
import type { CreateProcessResult, DraftApi, DraftKindName, ProposedLink } from "../../services/api";

export type DraftFlow<D extends BaseDraft> = ReturnType<typeof useDraftFlow<D>>;

/** Where the page was opened from: a revision, an edit of a live process. */
export interface DraftPageContext {
  isAdmin: boolean;
  /** `?review=`: a revision of that review (an admin asked for changes). */
  reviseReviewId: string | null;
  /** `?edit=`: an edit of that live process (projects). */
  editProcessId: string | null;
  searchParams: URLSearchParams;
  /** The hub, from DraftPage's useHub(): a kind's wording reads it here, not from the module (ADR-013). */
  hub: Hub;
}

/** What a kind's form gets from the page. */
export interface DraftFormProps<D extends BaseDraft> {
  /** The draft as shown: the saved one, or the empty one with what the visitor typed so far. */
  draft: D;
  /** The saved draft, once there is one. */
  saved: D | null;
  flow: DraftFlow<D>;
  ctx: DraftPageContext;
  links: ProposedLink[];
  onLinksChange: (links: ProposedLink[]) => void;
  linkTitles: Record<string, { title: string; type: string }>;
  onLinkTitlesChange: (t: Record<string, { title: string; type: string }>) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** A kind's own page state that its field list depends on (a vote's method). */
  kindState: Record<string, unknown>;
  setKindState: (patch: Record<string, unknown>) => void;
}

/** Where a submit sends the person. */
export interface DraftDestination {
  to: string;
  state?: unknown;
}

export interface DraftKindConfig<D extends BaseDraft> {
  kind: DraftKindName;
  /** Full registry type, e.g. "civic.proposal". */
  processType: string;
  emptyDraft: D;
  /** The body of the request that creates a draft (a proposal's category). */
  createBody?: Record<string, unknown>;
  /** A draft as the form and the assistant see it, and a patch back to the server's shape (a vote's options). */
  toFlow?: (d: D) => D;
  toServer?: (patch: Record<string, unknown>) => Record<string, unknown>;
  /** Fields Apply-suggestion may write. */
  applyFields: (kindState: Record<string, unknown>) => string[];
  shell: (ctx: DraftPageContext) => {
    backTo: string;
    backLabel: string;
    backAsButton?: boolean;
    title: string;
    /** No assistant (an edit of a live project). */
    noAssistant?: boolean;
  };
  Form: ComponentType<DraftFormProps<D>>;
  confirm: {
    title: (ctx: DraftPageContext) => string;
    /** Inside the preview, under the description. */
    previewExtra?: (draft: D, ctx: DraftPageContext) => ReactNode;
    /** Under the preview. */
    afterPreview?: (draft: D, ctx: DraftPageContext) => ReactNode;
    finality: (ctx: DraftPageContext) => string;
    /** The finality note in the edit colours. */
    finalityEdit?: (ctx: DraftPageContext) => boolean;
    /** "This <noun> was drafted with AI assistant help … <audience> will see …" */
    noun: string;
    audience: string;
    confirmLabel: (ctx: DraftPageContext) => string;
  };
  /** The live page of a process approved at once. */
  liveUrl: (processId: string) => string;
  /** A kind's own submit (a live edit); the default is a submission or revision for review. */
  submit?: (api: DraftApi<D>, draft: D, ctx: DraftPageContext) => Promise<DraftDestination | null>;
}

/** The default submit: for review (or a revision of one), or live when approved at once. */
export function reviewDestination(result: CreateProcessResult, liveUrl: (id: string) => string): DraftDestination {
  return result.auto_approved
    ? { to: liveUrl(result.process_id) }
    : {
        to: `/my-submissions/${result.review_id}`,
        state: { submitted: true, flagged: result.flagged === true, checkUnavailable: result.check_unavailable === true },
      };
}
