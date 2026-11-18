// A post News Sync copied in from another site (packages/civic.news_sync;
// Adam, 2026-11-18). Its feed card opens the original; this page is where the
// right column's card, search and an old /announcement/ link land: the title,
// the text the feed gave (or the paraphrase), who it is from, and a link to
// read it on the source's site. Nothing on it can be edited.

import { useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { getNewsItem, type NewsItem } from "../services/api";
import { relativeTime, absoluteTime } from "../utils/dates";
import { useHub } from "../config/hub";
import { syncedFrom } from "../../../src/shared/newsSource";
import ShareButton from "../components/ShareButton";
import SampleBadge from "../components/SampleBadge";
import RelatedProcesses from "../components/RelatedProcesses";
import "./Announcement.css";

export default function NewsItemPage() {
  const { id } = useParams<{ id: string }>();
  const hub = useHub();
  const { data: item, loading, error } = useApi<NewsItem>(id ? `news/${id}` : null, () => getNewsItem(id!));

  if (loading) {
    return (
      <div className="page announcement-page">
        <p className="announcement-status">Loading…</p>
      </div>
    );
  }
  if (error || !item) {
    return (
      <div className="page announcement-page">
        <p className="announcement-status announcement-status-error">{error?.message ?? "News item not found."}</p>
      </div>
    );
  }

  // The hub's labels as set now name every item it copied in (one source per hub).
  const pill = hub.setting("plugin.news_sync.pill_label")?.trim() || item.pill;
  const from = item.from ? syncedFrom(hub.setting("plugin.news_sync.from_label"), item.from) : null;

  return (
    <article className="page announcement-page">
      <div className="process-share-row">
        <ShareButton title={item.title} shareText={item.title} />
      </div>
      <header className="announcement-header">
        <p className="announcement-eyebrow">
          {pill}
          {item.is_sample && (
            <>
              {" "}
              <SampleBadge />
            </>
          )}
        </p>
        <h1>{item.title}</h1>
        <p className="announcement-meta">
          {from && <>From {from} · </>}
          <time dateTime={item.created_at} title={absoluteTime(item.created_at)}>
            {relativeTime(item.created_at)}
          </time>
        </p>
      </header>
      {item.body && (
        <div className="announcement-body">
          {item.body.split(/\n\n+/).map((para, i) => (
            <p key={i} className="announcement-paragraph">
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
