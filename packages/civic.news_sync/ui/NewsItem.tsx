// A post News Sync copied in from another site (Adam, 2026-11-18). Its feed card opens the original; this page is where the
// right column's card, search and an old /announcement/ link land: the title,
// the text the feed gave (or the paraphrase), who it is from, and a link to
// read it on the source's site. Nothing on it can be edited.

import { useParams } from "react-router-dom";
import {
  absoluteTime,
  RelatedProcesses,
  relativeTime,
  SampleBadge,
  ShareButton,
  useApi,
  useSpace,
} from "@civic-social/plugin-sdk/ui";
import { getNewsItem, type NewsItem } from "./api";
import "./NewsItem.css";

export default function NewsItemPage() {
  const { id } = useParams<{ id: string }>();
  const space = useSpace();
  const { data: item, loading, error } = useApi<NewsItem>(id ? `news/${id}` : null, () => getNewsItem(id!));

  if (loading) {
    return (
      <div className="page news-item-page">
        <p className="news-item-status">Loading…</p>
      </div>
    );
  }
  if (error || !item) {
    return (
      <div className="page news-item-page">
        <p className="news-item-status news-item-status-error">{error?.message ?? "News item not found."}</p>
      </div>
    );
  }

  // The hub's labels as set now name every item it copied in (one source per hub).
  const pill = space.setting("plugin.news_sync.pill_label").trim() || item.pill;
  const from = item.from ? space.setting("plugin.news_sync.from_label").trim() || item.from : null;

  return (
    <article className="page news-item-page">
      <div className="process-share-row">
        <ShareButton title={item.title} shareText={item.title} />
      </div>
      <header className="news-item-header">
        <p className="news-item-eyebrow">
          {pill}
          {item.is_sample && (
            <>
              {" "}
              <SampleBadge />
            </>
          )}
        </p>
        <h1>{item.title}</h1>
        <p className="news-item-meta">
          {from && <>From {from} · </>}
          <time dateTime={item.created_at} title={absoluteTime(item.created_at)}>
            {relativeTime(item.created_at)}
          </time>
        </p>
      </header>
      {item.body && (
        <div className="news-item-body">
          {item.body.split(/\n\n+/).map((para: string, i: number) => (
            <p key={i} className="news-item-paragraph">
              {para}
            </p>
          ))}
        </div>
      )}
      {item.share_url && (
        <p>
          <a href={item.share_url} target="_blank" rel="noopener noreferrer">
            Read it on {from ?? "the original site"}
          </a>
        </p>
      )}
      <RelatedProcesses processId={item.id} readOnly />
    </article>
  );
}
