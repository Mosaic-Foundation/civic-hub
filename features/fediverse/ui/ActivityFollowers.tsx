// The Fediverse card in Admin → Activity (Adam, 2026-11-14): how many accounts
// follow the hub from the fediverse, and how many started following in the
// period shown. Kept apart from the resident counts: a follower is not a
// resident taking part. Likes and boosts join it in phase 3.

import { useApi } from "../../../ui/src/hooks/useApi";
import { request } from "../../../ui/src/services/http";
import "./fediverse.css";

interface Followers {
  total: number;
  new_in_period: number;
}

export default function ActivityFollowers({ start, end, label }: { start: string; end: string; label: string }) {
  const followers = useApi(`fediverse/followers/${start}/${end}`, () =>
    request<Followers>("GET", `/admin/fediverse/followers?from=${start}&to=${end}`),
  );
  const f = followers.data;
  return (
    <section className="fediverse-activity" aria-labelledby="fediverse-activity" data-testid="activity-fediverse">
      <h2 id="fediverse-activity" className="kit-section-title">
        Fediverse
      </h2>
      <p className="admin-page-description">
        Accounts following this hub from Mastodon and other fediverse apps. They are not residents and are not counted
        above.
      </p>
      {followers.error && <p className="form-error">The follower count could not be loaded.</p>}
      {f && (
        <ul className="kit-stats activity-tiles">
          <li className="kit-card kit-stat kit-stat--featured activity-tile" data-testid="fediverse-followers-total">
            <span className="kit-stat-n activity-n">{f.total.toLocaleString()}</span>
            <span className="kit-stat-label activity-label">Followers now</span>
          </li>
          <li className="kit-card kit-stat kit-stat--featured activity-tile" data-testid="fediverse-followers-new">
            <span className="kit-stat-n activity-n">{f.new_in_period.toLocaleString()}</span>
            <span className="kit-stat-label activity-label">New followers, {label}</span>
          </li>
        </ul>
      )}
    </section>
  );
}
