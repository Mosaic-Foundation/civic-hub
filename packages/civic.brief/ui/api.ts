// Briefs' API client: the calls its pages make, and the shapes they read.
// Moved from the hub's ui/src/services/api.ts (kernel step 1).

import { apiRequest as request } from "@civic-social/plugin-sdk/ui";

/** An address a published item was not emailed to, and why. */
export interface HeldBackRecipient {
  email: string;
  reason: string;
}

// --- Universal briefs (civic.brief) ---
// The generic, admin-reviewed results for any closed process. Mirrors the
// vote-results API but with type-agnostic content (headline / summary /
// sections) instead of vote-specific position breakdowns.

export type BriefPublicationStatus = "pending" | "approved" | "published";

export interface BriefSection {
  heading: string;
  body: string;
}

export interface BriefContent {
  title: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  participation_label: string | null;
  participation_count: number | null;
  comments: string[];
  admin_notes: string;
  image_url?: string | null;
  image_alt?: string | null;
  /** The source closed before its deadline: the line and the admin's note. */
  closed_early?: { line: string; note: string } | null;
}

export interface BriefSummary {
  id: string;
  type: "civic.brief";
  title: string;
  source_process_id: string;
  source_process_type: string;
  publication_status: BriefPublicationStatus;
  headline: string;
  participation_count: number | null;
  summary_preview: string;
  generated_at: string;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
}

/** One delivery recipient picked during review. The email is where the
 *  brief is sent (admin-only); the label is what the published page's
 *  "Sent to …" receipt shows. `group`, when set, bundles this recipient
 *  under one office name on that receipt (all supervisors → "Board of
 *  Supervisors") while each address is still emailed individually. */
export interface BriefRecipient {
  email: string;
  label: string;
  group?: string;
}

export interface BriefDetail extends BriefSummary {
  content: BriefContent;
  delivered_to: string[];
  /** Per-review selection: null = never touched (approval falls back to
   *  the hub-wide setting), [] = explicitly no delivery. */
  recipients: BriefRecipient[] | null;
  delivered_at: string | null;
  delivered_to_labels: string[];
  /** Recipients held back on purpose (hub mode, sample content), with why. */
  held_back?: HeldBackRecipient[];
  held_back_labels?: string[];
  created_by: string;
  /** Regenerate: a new version waiting to be published (published briefs). */
  pending_revision?: { content: BriefContent; generated_at: string } | null;
  /** Versions it replaced, oldest first. */
  history?: Array<{ content: BriefContent; generated_at: string; replaced_at: string }>;
  /** When a regenerated version last replaced the published one. */
  revised_at?: string | null;
}

export interface PublicBrief {
  id: string;
  type: "civic.brief";
  title: string;
  source_process_id: string;
  source_process_type: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  participation_label: string | null;
  participation_count: number | null;
  comments: string[];
  admin_notes: string;
  image_url?: string | null;
  image_alt?: string | null;
  /** The source closed before its deadline: the line and the admin's note. */
  closed_early?: { line: string; note: string } | null;
  /** A regenerated version replaced the published one on this date. */
  revised_at?: string | null;
  delivered_recipient_count: number;
  /** Public-safe recipient labels ("Jane Doe, Board of Supervisors") and
   *  the actual send time — the "Sent to … on …" receipt. Empty/null on
   *  legacy deliveries, which render the governing-body wording. */
  sent_to: string[];
  delivered_at: string | null;
  /** Addressed to these (public labels), but the hub held the email back
   *  (a demo or beta hub, sample content): `not_sent_because` says why.
   *  Absent on briefs read from an older server. */
  addressed_to?: string[];
  not_sent_because?: string | null;
  approved_at: string | null;
  generated_at: string;
  published_at: string;
  /**
   * Official responses — the government's side of the record, appended
   * to the sealed brief. "awaiting" until the first response;
   * responded_at is the FIRST response's timestamp (the date the status
   * line renders) and never moves as follow-ups arrive.
   */
  response_status: "awaiting" | "responded";
  responded_at: string | null;
  responses: PublicBriefResponse[];
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** One official response on a brief, oldest first. The office fields are
 *  a snapshot taken at response time (a later demotion or retitle does
 *  not rewrite the record). */
export interface PublicBriefResponse {
  id: string;
  body: string;
  official_type: string;
  official_title: string;
  responder_name: string;
  created_at: string;
}

export interface BriefContentPatch {
  comments?: string[];
  admin_notes?: string;
  headline?: string;
  summary?: string;
  image_url?: string | null;
  image_alt?: string | null;
  /** Per-review delivery selection; [] means "publish with no email". */
  recipients?: BriefRecipient[];
}

export function adminListBriefs(
  status?: BriefPublicationStatus,
): Promise<BriefSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return request("GET", `/admin/briefs${params}`);
}

export function adminGetBrief(id: string): Promise<BriefDetail> {
  return request("GET", `/admin/briefs/${id}`);
}

export function adminPatchBrief(
  id: string,
  patch: BriefContentPatch,
): Promise<BriefDetail> {
  return request("PATCH", `/admin/briefs/${id}`, patch);
}

export function adminApproveBrief(
  id: string,
): Promise<{ message: string; brief: BriefDetail }> {
  return request("POST", `/admin/briefs/${id}/approve`);
}

/** Make a closed process's brief again: replaces an unpublished one, stages a published one's. */
export function adminRegenerateBrief(id: string): Promise<{ staged: boolean; brief: BriefDetail }> {
  return request("POST", `/admin/briefs/${id}/regenerate`);
}

/** The staged version replaces the published brief, in place. Nobody is emailed. */
export function adminPublishBriefRevision(id: string): Promise<{ brief: BriefDetail }> {
  return request("POST", `/admin/briefs/${id}/revision/publish`);
}

/** Drop the staged version. */
export function adminDiscardBriefRevision(id: string): Promise<{ brief: BriefDetail }> {
  return request("POST", `/admin/briefs/${id}/revision/discard`);
}

export function getPublicBrief(id: string): Promise<PublicBrief> {
  return request("GET", `/brief/${id}`);
}

// --- The kernel's links, as the pointers read the brief ⇄ source pair ---

/** One side of a link, as the kernel's GET /process/:id/links gives it (the fields the pointers read). */
export interface RenderedLink {
  id: string;
  peer: { id: string; type: string; title: string; href: string };
}

export function getProcessLinks(processId: string): Promise<{ outgoing: RenderedLink[]; incoming: RenderedLink[] }> {
  return request("GET", `/process/${processId}/links`);
}

/** Post a public official response (official-role accounts only; 403
 *  otherwise). Returns the refreshed response list + status. */
export function postBriefResponse(
  id: string,
  body: string,
): Promise<{
  message: string;
  response_id: string;
  response_status: "awaiting" | "responded";
  responded_at: string | null;
  responses: PublicBriefResponse[];
}> {
  return request("POST", `/brief/${id}/response`, { body });
}

// --- Outcomes index --------------------------------------------------------

export interface OutcomeEntry {
  id: string;
  /** Sample content (Phase 7): shows the Sample badge. */
  is_sample?: boolean;
  title: string;
  source_process_id: string;
  source_process_type: string;
  headline: string;
  participation_label: string | null;
  published_at: string;
  /** Links on the process this brief summarizes — "does this sit in a thread". */
  related_count: number;
}

export interface OutcomesPage {
  outcomes: OutcomeEntry[];
  total: number;
  total_unfiltered: number;
  filters: { source_types: string[]; years: number[] };
}

export function getOutcomes(params: {
  sourceTypes?: string[];
  year?: number | null;
  sort?: "newest" | "oldest";
} = {}): Promise<OutcomesPage> {
  const qs = new URLSearchParams();
  for (const t of params.sourceTypes ?? []) qs.append("source_type", t);
  if (params.year != null) qs.set("year", String(params.year));
  if (params.sort) qs.set("sort", params.sort);
  const q = qs.toString();
  return request("GET", `/brief${q ? `?${q}` : ""}`);
}
