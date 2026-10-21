// What one process type's UI is, in one place (the UI half of ADR-009: a
// process type describes itself). The server half is the manifest
// (src/processes/manifest.ts); each type's module here (vote.tsx, ...) exports
// one ProcessUi, and index.ts lists them. App, the feed, the Plugins page and
// the link picker read the list instead of keeping a hand map of types.

import type { ReactElement, ReactNode } from "react";
import type { Activity, ActivityKind } from "../../../src/shared/feedActivity";
import type { CivicEvent, RelationType } from "../services/api";
import type { FormApi } from "../pages/settings/pluginFields";

/** One page of a type: its path, and who may open it. */
export interface ProcessRoute {
  path: string;
  element: ReactElement;
  /** Wrapped in <AdminGuard>. */
  admin?: true;
  /**
   * Mounted without the plugin gate: the page itself shows "not found" for a
   * record whose own plugin is off (the generic /process/:id page, which
   * hands every type to its own page and so cannot know the plugin up front).
   */
  ungated?: true;
}

/**
 * What the feed fetches per process for its cards (title, counts, image).
 * Each kind fills a different subset:
 *
 *   vote-open      → totalVotes
 *   vote-results   → totalVotes (= participation_count) + commentsCount
 *   announcement   → editCount + lastEditedAt (ISO)
 *   meeting        → blockCount + maxStartSeconds (for duration)
 */
export interface ProcessMeta {
  title?: string;
  description?: string;
  /**
   * Slice 9 — the post's attached image (if any). When set, the feed
   * card uses it as a leading visual; when unset, the card renders
   * plain (no gradient cover, no OG fallback).
   */
  imageUrl?: string | null;
  imageAlt?: string | null;
  totalVotes?: number;
  commentsCount?: number;
  editCount?: number;
  lastEditedAt?: string | null;
  blockCount?: number;
  maxStartSeconds?: number | null;
}

/** The text of a feed card: derived from the classified kind, the event and the fetched meta. */
export interface CardText {
  title: string;
  summary: string;
  authorName?: string | null;
  /** Event-derived metadata line. When set, it wins over the Feed
   *  container's fetched-meta engagement (which knows nothing about
   *  this event's payload). */
  engagement?: string | null;
}

/** What a kind's card text is built from. */
export interface CardTextContext {
  activity: Activity;
  event: CivicEvent;
  /** The event's process id. */
  id: string;
  data: Record<string, unknown>;
  getTitle: (id: string) => string | undefined;
  getDescription: (id: string) => string | undefined;
  /** The first line of the process's description ("" when none). */
  descSummary: string;
}

/** What a meta lookup may ask of the feed. */
export interface MetaLookupContext {
  /** The record was removed by a moderator: drop its cards. */
  markRemoved(id: string): void;
}

/** How one feed kind renders. */
export interface FeedKindUi {
  /** The card's title, summary and byline. */
  card(ctx: CardTextContext): CardText;
  /** The compact line under the summary, from the fetched meta; null suppresses it. */
  engagement?(meta: ProcessMeta): string | null;
  /** Fetches this process's meta; null (or a failure) caches it as empty. Absent: nothing to fetch. */
  meta?(id: string, ctx: MetaLookupContext): Promise<ProcessMeta | null>;
  /** The card's title comes from the fetched meta, so the card waits for it. */
  titleNeedsMeta?: true;
}

/** The interface each process type's UI module exports. */
export interface ProcessUi {
  /** A manifest's descriptor.type. */
  type: string;
  /**
   * This type's pages: list, create, detail, its admin pages. App wraps each
   * in whenPlugin(<the type's plugin>, ...) and, when `admin`, in <AdminGuard>.
   */
  routes: ReadonlyArray<ProcessRoute>;
  /** How this type's feed kinds render. */
  feed?: Partial<Record<ActivityKind, FeedKindUi>>;
  /** Its plugin's panel on the Plugins page; only on the type whose manifest carries pluginSection. */
  settingsPanel?: (f: FormApi) => ReactNode;
  /** The relation the link picker offers first when linking FROM a process of this type. */
  linkRelation?: RelationType;
}
