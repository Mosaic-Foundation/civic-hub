// A roundup's page on the hub (/fediverse/roundups/:id): every item a daily
// or weekly fediverse post listed, each linking to its page. The post shows
// the first few; this is where "All of them" goes.

import { Link, useParams } from "react-router-dom";
import { useApi } from "../../../ui/src/hooks/useApi";
import { request } from "../../../ui/src/services/http";
import { useHub } from "../../../ui/src/config/hub";
import "./fediverse.css";

interface RoundupView {
  id: string;
  kind: "item" | "roundup";
  published_at: string;
  items: Array<{ title: string; pill: string; url: string }>;
}

/** An item's link inside the hub: its path, so the app routes it; another site's address as it is. */
function localPath(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export default function RoundupPage() {
  const { id = "" } = useParams();
  const hub = useHub();
  const view = useApi(`fediverse/roundup/${id}`, () => request<RoundupView>("GET", `/fediverse/posts/${encodeURIComponent(id)}`));
  const r = view.data;
  const when = r ? new Date(r.published_at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
  return (
    <div className="page fediverse-roundup" data-testid="fediverse-roundup">
      <h1>What's new on {hub.name}</h1>
      {view.error && <p className="form-error">This roundup isn't here. <Link to="/">See what's on the hub now.</Link></p>}
      {r && (
        <>
          <p className="admin-page-description">As posted to the hub's fediverse followers on {when}.</p>
          <ul className="fediverse-roundup-list">
            {r.items.map((i) => {
              const path = localPath(i.url);
              return (
                <li key={i.url}>
                  <span className="fediverse-roundup-pill">{i.pill}</span>{" "}
                  {path ? <Link to={path}>{i.title}</Link> : <a href={i.url}>{i.title}</a>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
