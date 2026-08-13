// civic.brief module — type definitions
//
// A Brief is a structured, admin-reviewed summary of ANY completed civic
// process — the universal generalization of civic.vote_results. Where
// vote_results is vote-specific (tally, position breakdown, vote context),
// a Brief carries a type-agnostic shape (headline, summary, flexible
// sections) that every process type produces on close via its handler's
// `generateBrief` method.
//
// A Brief is itself a civic process (type "civic.brief"), stored in the
// same processes table — no new table. Its lifecycle mirrors
// vote_results: created `pending`, admin reviews and edits, then approves
// which delivers it to officials and publishes it to the public feed.
//
// COEXISTENCE: this module runs ALONGSIDE civic.vote_results, which keeps
// handling votes unchanged. Briefs cover conversation / proposal / project
// (and any future type). A vote's results can be represented in this same
// generic shape later, so migrating votes onto civic.brief is additive —
// existing vote_results records and URLs keep working untouched.
//
// Like vote_results, this module is self-contained and portable: the host
// hub injects callbacks for event emission, email delivery, and finalizing
// the source process. The module knows nothing of Express, the registry,
// Supabase, or nodemailer.

export type BriefPublicationStatus = "pending" | "approved" | "published";

/** Cap on image alt-text / url — kept in sync with civic.announcement. */
export const IMAGE_ALT_MAX = 200;
export const IMAGE_URL_MAX = 1000;

/**
 * One structured block of a brief. Type-specific detail lives here:
 * conversation → opinion clusters / common ground; proposal → support
 * breakdown; project → milestones; vote (later) → position breakdown.
 */
export interface BriefSection {
  heading: string;
  body: string;
}

/**
 * The generic, type-agnostic content of a brief. A process handler's
 * `generateBrief` produces this; admin can edit `comments` / `admin_notes`
 * / image during review (the rest is a frozen snapshot of the outcome).
 */
export interface BriefContent {
  /** The source process's title. */
  title: string;
  /** One-line outcome, e.g. "Community reached broad agreement" or
   *  "Advanced to a vote" or "Project completed". */
  headline: string;
  /** Main readable body of the outcome. */
  summary: string;
  /** Type-specific structured detail (may be empty). */
  sections: BriefSection[];
  /** Human label for participation, e.g. "42 participants",
   *  "18 endorsements". Null when not applicable. */
  participation_label: string | null;
  participation_count: number | null;
  /** Resident voices surfaced alongside the outcome; admin-editable. */
  comments: string[];
  admin_notes: string;
  /** Optional featured image (public Supabase Storage URL). */
  image_url?: string | null;
  image_alt?: string | null;
}

/**
 * Shape of Process.state for a civic.brief process.
 *
 * The process-level `status` tracks the lifecycle state machine; the
 * brief-specific `publication_status` tracks the admin review sub-state:
 *   pending   — auto-generated on source close, awaiting admin review
 *   approved  — admin approved, delivered to officials, not yet public
 *   published — final: visible on the public brief page + feed post
 */
export interface BriefProcessState {
  type: "civic.brief";
  /** The process this brief summarizes. */
  source_process_id: string;
  /** The type of the source process (e.g. "civic.polis_deliberation"),
   *  so read models and the feed can render type-appropriate framing. */
  source_process_type: string;
  publication_status: BriefPublicationStatus;
  generated_at: string; // ISO 8601
  approved_at: string | null;
  published_at: string | null;
  content: BriefContent;
  delivered_to: string[]; // email recipients recorded on approval
}

/**
 * Event emission callback — injected by the host hub. Mirrors
 * civic.vote_results/EmitEventFn.
 */
export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    hub_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    processType?: string;
    action_url_path?: string;
  }): Promise<unknown>;
}

/** Email delivery callback — injected by the host hub. Throws on failure. */
export interface SendEmailFn {
  (message: {
    to: string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

/**
 * Finalize-source-process callback — injected by the host hub. Called
 * after a brief transitions to "published". Signals the source process to
 * finalize (e.g. mark the conversation/proposal/project finalized). The
 * hub wires this per source type. Distinct from archival: publishing a
 * brief does not hide the source; archival is a separate admin action that
 * takes the brief with it.
 */
export interface FinalizeSourceFn {
  (sourceProcessId: string, sourceProcessType: string, actor: string): Promise<void>;
}

export interface BriefProcessContext {
  process_id: string;
  hub_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

/** Standard outcome returned by module actions. */
export interface BriefActionOutcome {
  state: BriefProcessState;
  result: Record<string, unknown>;
}

/**
 * Input the hub passes when creating a brief from a closed process. The
 * `content` is produced by the source handler's `generateBrief` — this
 * module does not read the source process directly.
 */
export interface CreateBriefInput {
  source_process_id: string;
  source_process_type: string;
  content: BriefContent;
}

/** Partial content update used by PATCH /admin/briefs/:id. */
export interface BriefContentPatch {
  comments?: string[];
  admin_notes?: string;
  headline?: string;
  summary?: string;
  image_url?: string | null;
  image_alt?: string | null;
}
