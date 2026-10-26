// The brief contract: what a process type's generateBrief returns (the
// type-agnostic content of a Civic Brief). Here, in the process contract, so
// the handler interface (src/processes/types.ts) depends on no plugin;
// packages/civic.brief stores and publishes it and re-exports these types
// (Architecture 2, 2026-10-21).

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
  /**
   * The source was closed before its deadline (Close early): the line the
   * brief shows, and the admin's note, verbatim. Set when the brief is made.
   */
  closed_early?: { line: string; note: string } | null;
  /**
   * Raw material the source hands its brief to finish (plugin session 2): a
   * result whose write-up needs the AI, which is the brief's to call. The
   * brief's finalize (packages/civic.brief/finalize.ts) turns it into the
   * fields above and `deliberation`, and drops it before anything is stored.
   */
  source_result?: BriefSourceResult | null;
  /** A conversation's summary as its page shows it, made by the brief from a deliberation result. */
  deliberation?: DeliberationSummary | null;
}

/** What a source hands its brief to finish. One kind so far. */
export type BriefSourceResult = DeliberationResult;

/**
 * A closed conversation's result as data, pulled from the deliberation
 * service when it closes: no AI has touched it.
 */
export interface DeliberationResult {
  kind: "deliberation";
  topic: string;
  /** Where the conversation's own data lives in the deliberation service. */
  data_uri: string;
  /** Pulled from the fake deliberation service (development and tests): the brief asks no model. */
  fake?: boolean;
  participant_count: number;
  statement_count: number;
  groups: Array<{
    id: number;
    size: number;
    representative_statements: Array<{ text: string; repness: number; direction: "agree" | "disagree" }>;
  }>;
  consensus: {
    agree: Array<{ statement_id: number; text: string; agree_rate: number; vote_count: number }>;
    disagree: Array<{ statement_id: number; text: string; agree_rate: number; vote_count: number }>;
  };
  /** Every statement's text by id (the consensus lists may carry an older text). */
  statements: Array<{ id: number; text: string }>;
}

/** A conversation's summary: the AI's write-up of a deliberation result, and the result's own figures. */
export interface DeliberationSummary {
  summary_text: string;
  directed_questions: string[];
  top_consensus_statements: { statement_text: string; agree_rate: number; vote_count: number }[];
  opinion_groups: {
    group_id: number;
    size: number;
    representative_statements: { text: string; agreement_within_group: number }[];
  }[];
  participation_stats: {
    total_participants: number;
    total_statements: number;
    total_votes: number;
    opinion_groups_formed: number;
  };
  linked_polis_data_uri: string;
  methodology: { prompt_version: string; model_used: string; generated_at: string };
  /**
   * Why there is no write-up (`summary_text` empty): the AI failed, or this
   * hub has not allowed briefs to use it. Absent when there is one.
   */
  narrative?: "failed" | "not_allowed";
}
