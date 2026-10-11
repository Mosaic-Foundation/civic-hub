// civic.receipts module — type definitions
//
// Maintains strict separation between vote records and user identity.
// The votes table stores receipt_id + choice with NO user reference.
// The participation table stores user_id + process_id with NO receipt reference.

export interface VoteRecord {
  receipt_id: string;
  process_id: string;
  choice: string;
  /** sha256 of the change key the voter holds; never exposed. */
  change_key_hash: string | null;
  // No time: vote_records.created_at is always NULL (20261010000000).
}

export interface UserParticipation {
  user_id: string;
  process_id: string;
  has_voted: boolean;
}
