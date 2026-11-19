// The Feedback plugin's calls (features/feedback/routes.ts).

import { request, upload } from "../../../ui/src/services/http";
import type { UploadedImage } from "../../../ui/src/services/api";

// Mirrors FeedbackCategory in ../models.ts; the server validates against its own list.
export type FeedbackCategory =
  | "idea"
  | "topic"
  | "bug"
  | "moderation"
  | "general";

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  message: string;
  name?: string | null;
  email?: string | null;
  /**
   * Honeypot — real users leave this empty. Bots fill every input. The
   * server returns 200 either way so spam can't probe the difference.
   */
  website?: string;
  /** Signed-in only; the form offers the picker only when signed in. */
  screenshot_url?: string | null;
  /** The page the person came from (services/lastPage.ts). */
  page_path?: string | null;
  /** "Civic.Social may contact me about this". */
  contact_ok?: boolean;
}

export function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<{ message: string; submission_id?: string; shared_with_civic_social?: boolean }> {
  return request("POST", "/feedback", input);
}

/** A screenshot for a bug report — same validation and bucket as the other
 *  image uploads; signed-in only. */
export function uploadFeedbackScreenshot(file: Blob): Promise<UploadedImage> {
  return upload("/feedback/screenshot", file);
}

/** One row of the admin feedback archive. Admin-only — carries PII. */
export interface FeedbackSubmission {
  id: string;
  created_at: string;
  category: FeedbackCategory;
  message: string;
  name: string | null;
  email: string | null;
  user_id: string | null;
  user_agent: string | null;
  /** Optional screenshot on a bug report. */
  screenshot_url: string | null;
  page_path: string | null;
  software_version: string | null;
  contact_ok: boolean;
  /** Civic.Social's copy and its status, when the item was shared. */
  mosaic: MosaicCopy | null;
}

/** Mirrors MosaicCopy in ../models.ts. */
export type MosaicStatus = "received" | "planned" | "fixed";
export type MosaicStream = "bug" | "feature";
export interface MosaicCopy {
  stream: MosaicStream;
  status: MosaicStatus;
  sent_at: string;
  sent_by: "sender" | "admin";
}

/** "Send to Civic.Social": once per item, in the stream the admin picks. */
export function adminForwardFeedback(id: string, stream: MosaicStream): Promise<{ item: FeedbackSubmission }> {
  return request("POST", `/admin/feedback/${encodeURIComponent(id)}/forward`, { stream });
}

/**
 * Admin feedback archive, newest first. `category` omitted (or "all")
 * returns every category. Read-only: there is no write counterpart.
 */
export function adminListFeedback(
  category?: FeedbackCategory | "all",
): Promise<{ items: FeedbackSubmission[]; count: number }> {
  const qs =
    category && category !== "all"
      ? `?category=${encodeURIComponent(category)}`
      : "";
  return request("GET", `/admin/feedback${qs}`);
}
