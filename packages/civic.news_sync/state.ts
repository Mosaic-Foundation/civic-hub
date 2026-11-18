// The News item's state, its read model and its event payload. Pure.

import { ValidationError } from "@civic-social/plugin-sdk";
import { BODY_MAX, BODY_PREVIEW_LEN, DEFAULT_NEWS_PILL, TITLE_MAX, type NewsProcessState, type NewsSource } from "./models.js";

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A new item's state from what the job hands createProcess. */
export function createNewsState(input: Record<string, unknown>, now: string = new Date().toISOString()): NewsProcessState {
  const title = text(input.title);
  if (!title) throw new ValidationError("A News item needs a title.", "missing_field");
  if (title.length > TITLE_MAX) throw new ValidationError(`A News item's title is at most ${TITLE_MAX} characters.`);
  const body = text(input.body).slice(0, BODY_MAX);
  const raw = (input.source ?? {}) as Record<string, unknown>;
  const share_url = text(raw.share_url);
  if (!/^https?:\/\//i.test(share_url)) {
    throw new ValidationError("A News item needs the address of the original.", "missing_field");
  }
  const source: NewsSource = {
    origin: text(raw.origin) || "news-sync",
    share_url,
    ingested_at: text(raw.ingested_at) || now,
    ...(text(raw.connector) ? { connector: text(raw.connector) } : {}),
    ...(text(raw.label) ? { label: text(raw.label) } : {}),
    ...(text(raw.pill) ? { pill: text(raw.pill) } : {}),
  };
  return { type: "civic.news", content: { title, body }, source, created_at: now };
}

/**
 * The "From" label a hub's posts are copied in with: its setting
 * (plugin.news_sync.from_label), else "<place> Government", what synced posts
 * have always been labelled, else "Local Government" where the hub serves no
 * place.
 */
export function newsFromLabel(setting: string | null | undefined, place: string | null | undefined): string {
  const own = setting?.trim();
  if (own) return own;
  return place ? `${place} Government` : "Local Government";
}

/** The pill a hub's posts are copied in with: its setting (plugin.news_sync.pill_label), else "News". */
export function newsPillLabel(setting: string | null | undefined): string {
  return setting?.trim() || DEFAULT_NEWS_PILL;
}

/** Who it is from: the label it was copied in with, else (a relabelled announcement) its author label. */
export function newsFrom(state: NewsProcessState): string | null {
  return state.source?.label?.trim() || state.author_role?.trim() || null;
}

/** Its pill: as copied in, else "News". */
export function newsPill(state: NewsProcessState): string {
  return state.source?.pill?.trim() || DEFAULT_NEWS_PILL;
}

/** What anyone may read: no account, no name. */
export function newsReadModel(state: NewsProcessState, meta: { id: string; createdAt: string }): Record<string, unknown> {
  return {
    id: meta.id,
    type: "civic.news",
    title: state.content?.title ?? "",
    body: state.content?.body ?? "",
    from: newsFrom(state),
    pill: newsPill(state),
    share_url: state.source?.share_url ?? null,
    connector: state.source?.connector ?? null,
    created_at: state.created_at ?? meta.createdAt,
  };
}

/** The `news` field of its published event. */
export function newsPayload(state: NewsProcessState): Record<string, unknown> {
  return {
    title: state.content.title,
    body_preview: state.content.body.trim().slice(0, BODY_PREVIEW_LEN),
    source: {
      share_url: state.source.share_url,
      ...(state.source.connector ? { connector: state.source.connector } : {}),
      ...(newsFrom(state) ? { label: newsFrom(state) } : {}),
      pill: newsPill(state),
    },
  };
}
