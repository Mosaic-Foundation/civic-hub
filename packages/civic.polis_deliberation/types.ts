export interface DeliberationSummary {
  summary_text: string;
  directed_questions: string[];
  top_consensus_statements: {
    statement_text: string;
    agree_rate: number;
    vote_count: number;
  }[];
  opinion_groups: {
    group_id: number;
    size: number;
    representative_statements: {
      text: string;
      agreement_within_group: number;
    }[];
  }[];
  participation_stats: {
    total_participants: number;
    total_statements: number;
    total_votes: number;
    opinion_groups_formed: number;
  };
  linked_polis_data_uri: string;
  methodology: {
    prompt_version: string;
    model_used: string;
    generated_at: string;
  };
}

export interface PolisDeliberationState {
  polis_conversation_id: string;
  polis_base_url: string;
  topic: string;
  framing: string;
  deadline: string | null;
  /**
   * Participation window in milliseconds. When set and no explicit
   * deadline was given, the "start" action computes
   * deadline = start time + duration_ms — so the window measures ACTIVE
   * time, not time spent waiting in the review queue.
   */
  duration_ms: number | null;
  participation_threshold: number | null;
  /** Public transparency label: assistant-produced text was used drafting
   *  the topic/framing. Mirrors proposals' assistant_helped. */
  assistant_helped: boolean;
  /**
   * Seed statements to plant when the Polis conversation is created. Must
   * live ON STATE: the "start" action (which may run at approval, long
   * after creation) reads them from here. Before 2026-08-28 initializeState
   * dropped this field, so review-path conversations silently lost their
   * seeds — the input carried them, the state never did.
   */
  seed_statements: string[] | null;
  /** "Learn more" links shown under the framing. */
  sources: string[] | null;
  last_math_tick: number;
  summary: DeliberationSummary | null;
  summary_status: "pending" | "generating" | "complete" | "failed";
  continued_from_response_id: string | null;
}

export interface PolisDeliberationInput {
  topic: string;
  framing: string;
  deadline?: string;
  /** Alternative to an explicit deadline: window length, anchored at start. */
  duration_ms?: number;
  participation_threshold?: number;
  assistant_helped?: boolean;
  sources?: string[];
  seed_statements?: string[];
  continued_from_response_id?: string;
  polis_moderation?: "open" | "strict";
}
