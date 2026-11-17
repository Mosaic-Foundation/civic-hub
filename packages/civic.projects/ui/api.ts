// Projects' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): its own routes under /projects, and its
// banner picture's upload.

import {
  apiRequest,
  apiUpload,
  askAboutYouFirst,
  type DraftSuggestion,
  type ProposedLink,
  type UploadedImage,
} from "@civic-social/plugin-sdk/ui";


export type ProjectStatus = "active" | "archived";
export type SentimentValue = "support" | "oppose";

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  // Redacted ("") on the public LIST; retained on the DETAIL only for the
  // owner edit-affordance check. Never render it — use creator_name.
  user_id: string;
  creator_name: string;
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  status: ProjectStatus;
  support_count: number;
  oppose_count: number;
  assistant_helped: boolean;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  created_at: string;
  updated_at: string;
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

export interface ProjectUpdateEntry {
  id: string;
  project_id: string;
  content: string;
  media_urls: string[];
  created_at: string;
}

export interface ProjectComment {
  id: string;
  project_id: string;
  // Raw id is redacted ("") on public responses; use creator_name.
  user_id: string;
  creator_name: string;
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  content: string;
  created_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  sources: string[];
  updates: ProjectUpdateEntry[];
  user_sentiment: SentimentValue | null;
  comment_count: number;
  // Server-computed: is the authenticated caller the project owner? Replaces
  // the client-side user_id compare so the raw id stays off the wire.
  is_owner?: boolean;
}

export function listProjects(status?: ProjectStatus): Promise<ProjectSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest("GET", `/projects${params}`);
}

/** Per-actor fields come from the session token, never from a query param. */
export function getProjectDetail(id: string): Promise<ProjectDetail> {
  return apiRequest("GET", `/projects/${id}`);
}

export function completeProject(
  id: string,
): Promise<{ ok: boolean; message: string; view: ProjectDetail | null }> {
  return apiRequest("POST", `/projects/${id}/complete`);
}

export async function setProjectSentiment(
  id: string,
  sentiment: SentimentValue | "neutral",
): Promise<{ support_count: number; oppose_count: number; user_sentiment: SentimentValue | null; view: ProjectDetail | null }> {
  await askAboutYouFirst();
  return apiRequest("POST", `/projects/${id}/sentiment`, { sentiment });
}

// Project comments and creator updates go through submitInput / getInputs —
// the shared comment module, so projects moderate like every other type.

// --- Project Drafts (AI-augmented project drafting) ---

export interface ProjectDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

export function uploadProjectImage(file: Blob): Promise<UploadedImage> {
  return apiUpload("/upload/project-image", file);
}
