export type ProjectStatus = "active" | "archived" | "completed";

export type SentimentValue = "support" | "oppose";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string[];
  status: ProjectStatus;
  support_count: number;
  oppose_count: number;
  assistant_helped: boolean;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  content: string;
  media_urls: string[];
  created_at: string;
}

export interface ProjectSentiment {
  project_id: string;
  user_id: string;
  sentiment: SentimentValue;
  created_at: string;
  updated_at: string;
}

export interface ProjectComment {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface CreateProjectInput {
  /**
   * Optional fixed id. The review-approval flow passes the canonical
   * `processes` row id here so the project child row shares one id with its
   * process record (no forking a new id on approval). Omitted for any other
   * caller, which mints a fresh `proj_` id.
   */
  id?: string;
  title: string;
  description?: string;
  sources?: string[];
  user_id: string;
  assistant_helped?: boolean;
  banner_image_url?: string | null;
  banner_image_alt?: string | null;
}
