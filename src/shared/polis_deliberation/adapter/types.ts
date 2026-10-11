// Civic-domain types for the PolisAdapter's public interface.
// Callers see these types; Polis API specifics stay inside the adapter.

export interface PolisAdapterConfig {
  baseUrl: string;
  authToken: string;
  /**
   * The fetch to use. The hub passes its SSRF-guarded fetch (Audit 2): a
   * hub's admin chooses the Polis URL, so it must not reach an internal
   * address. Defaults to the global fetch.
   */
  fetch?: (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ) => Promise<Response>;
}

export interface CreateDeliberationInput {
  topic: string;
  description: string;
  strict_moderation: boolean;
  seed_statements?: string[];
}

export type VoteDirection = "agree" | "disagree" | "pass";

export interface Statement {
  id: number;
  text: string;
  is_seed: boolean;
  created: string;
}

export interface OpinionGroup {
  id: number;
  size: number;
  representative_statements: {
    text: string;
    direction: "agree" | "disagree";
    repness: number;
  }[];
}

export interface ConsensusStatement {
  statement_id: number;
  text: string;
  agree_rate: number;
  vote_count: number;
}

export interface ClusterState {
  participant_count: number;
  statement_count: number;
  math_tick: number;
  groups: OpinionGroup[];
  consensus: {
    agree: ConsensusStatement[];
    disagree: ConsensusStatement[];
  };
}

export interface PolisAdapter {
  createDeliberation(
    input: CreateDeliberationInput,
  ): Promise<{ conversation_id: string }>;
  submitStatement(
    conversationId: string,
    actorXid: string,
    text: string,
  ): Promise<{ statement_id: number }>;
  recordVote(
    conversationId: string,
    actorXid: string,
    statementId: number,
    vote: VoteDirection,
  ): Promise<void>;
  getNextStatement(
    conversationId: string,
    actorXid: string,
  ): Promise<Statement | null>;
  pullClusterState(conversationId: string): Promise<ClusterState>;
  closeDeliberation(conversationId: string): Promise<void>;
  getStatements(conversationId: string): Promise<Statement[]>;
}

// Raw Polis API response shapes — internal to the adapter implementation

export interface PolisConversationResponse {
  url: string;
  zid: number;
}

export interface PolisConversation {
  conversation_id: string;
  zid: number;
  topic: string;
  description: string;
  is_active: boolean;
  participant_count: number;
}

export interface PolisComment {
  tid: number;
  txt: string;
  pid: number;
  created: string;
  mod: number;
  is_seed: boolean;
}

export interface PolisGroupCluster {
  id: number;
  center: [number, number];
  members: number[];
}

export interface PolisRepComment {
  tid: number;
  repness: number;
  "repful-for": "agree" | "disagree";
  "n-agree": number;
  "n-disagree": number;
}

export interface PolisConsensusItem {
  tid: number;
  "n-success": number;
  "n-trials": number;
  "p-success": number;
}

export interface PolisGroupVotes {
  votes: Record<string, { A: number; D: number; S: number }>;
  "n-members": number;
}

export interface PolisMathResult {
  n: number;
  "n-cmts": number;
  math_tick: number;
  "group-clusters": PolisGroupCluster[];
  "group-votes": Record<string, PolisGroupVotes>;
  repness: Record<string, PolisRepComment[]>;
  consensus: {
    agree: PolisConsensusItem[];
    disagree: PolisConsensusItem[];
  };
}

export interface PolisNextCommentResponse {
  tid: number;
  txt: string;
  created: string;
  is_seed: boolean;
}

export interface PolisVotePayload {
  conversation_id: string;
  tid: number;
  vote: -1 | 0 | 1;
  xid: string;
}
