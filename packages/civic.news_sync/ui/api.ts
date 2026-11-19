// News Sync's API client: one News item, for its page and its feed card.

import { apiRequest } from "@civic-social/plugin-sdk/ui";

/** GET /news/:id (./controller.ts). */
export interface NewsItem {
  id: string;
  type: "civic.news";
  title: string;
  body: string;
  /** "From …": who its source is, as copied in. */
  from: string | null;
  /** Its pill as copied in ("News"). */
  pill: string;
  /** The original, on the source's own site. */
  share_url: string | null;
  connector: string | null;
  created_at: string;
  is_sample?: boolean;
}

export function getNewsItem(id: string): Promise<NewsItem> {
  return apiRequest("GET", `/news/${id}`);
}
