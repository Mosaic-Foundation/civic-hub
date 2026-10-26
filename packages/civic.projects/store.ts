// What civic.projects keeps (ADR-012, the database convention): the package
// never imports src/db/. The implementation is ./storeImpl.ts, on the database
// its host hands it (its granted tables only), bound when the hub loads the
// package (./index.ts). The tables are `projects`, `project_sentiments` and
// `project_drafts`; a project's updates and comments are civic.input's rows,
// read through that module.

import { storeSlot } from "../../src/sdk/index.js";
import type { ProjectStatus, SentimentValue } from "./models.js";

/** A stored project, as the `projects` table has it. */
export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  sources: string[] | null;
  status: ProjectStatus;
  support_count: number;
  oppose_count: number;
  assistant_helped: boolean;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectsStore {
  /** Store one project (the columns the caller sets) and return the row. */
  insertProject(row: Record<string, unknown>): Promise<ProjectRow>;
  /** One project by id, or null. */
  findProject(id: string): Promise<ProjectRow | null>;
  /** Newest first (paged past 1,000): one status, or every status but archived. */
  listProjects(status?: ProjectStatus): Promise<ProjectRow[]>;
  /** Write columns on a project and return the row. */
  updateProject(id: string, updates: Record<string, unknown>): Promise<ProjectRow>;
  /** Write columns on a project (no row back). */
  patchProject(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Complete a project, only if it is still active. */
  completeIfActive(id: string): Promise<void>;
  /** A project's status as stored, or undefined when there is no row. */
  statusOf(id: string): Promise<string | undefined>;
  /** Set a project's status (and the update time). */
  setStatus(id: string, status: string): Promise<void>;

  /** Remove one person's sentiment. */
  deleteSentiment(projectId: string, userId: string): Promise<void>;
  /** Set one person's sentiment (one per person per project). */
  upsertSentiment(projectId: string, userId: string, sentiment: SentimentValue): Promise<void>;
  /** One person's sentiment, or null. */
  sentimentOf(projectId: string, userId: string): Promise<SentimentValue | null>;
  /** How many people hold this sentiment on a project. */
  countSentiments(projectId: string, sentiment: SentimentValue): Promise<number>;
  /** Write the reconciled counts on the project (and the update time). */
  setSentimentCounts(projectId: string, counts: { support_count: number; oppose_count: number }): Promise<void>;
  /** The user ids supporting a project, all of them (paged past 1,000). */
  supporterIds(projectId: string): Promise<string[]>;
  /** The ids of the projects a person supports. */
  supportedProjectIds(userId: string): Promise<string[]>;

  /** Clear a project draft's check result, so the check must run again. */
  resetDraftReview(draftId: string): Promise<void>;
  /** Development seed only: every project and sentiment on the hub. */
  deleteAll(): Promise<void>;
}

export const projectsStore = storeSlot<ProjectsStore>("civic.projects");
