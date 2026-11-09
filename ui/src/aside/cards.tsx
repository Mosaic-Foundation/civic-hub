// The hub's own right-column cards (ADR-019): Coming up, Announcements and
// About. Each draws nothing when it has nothing to say, so an empty card is
// never a box with a heading and no rows. Kit surfaces and tokens only.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "../kit";
import { useHub } from "../config/hub";
import { useAuth } from "../context/authState";
import { processTypes } from "../config/navigation";
import { detailPathOf } from "../processes/display";
import AuthModal from "../components/AuthModal";
import { localShortDate } from "../utils/dates";
import { CALENDAR_PLUGIN, type AsideData } from "./useAsideData";
import { comingUpRows, dateTile, timeOfDay } from "./comingUp";

function AsideCard({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const headId = `aside-${id}-title`;
  return (
    <Card className="aside-card" data-aside-card={id} role="region" aria-labelledby={headId}>
      <h2 className="aside-card-title" id={headId}>
        {title}
      </h2>
      {children}
    </Card>
  );
}

export function ComingUpCard({ data }: { data: AsideData }) {
  const hub = useHub();
  const calendar = processTypes().filter((t) => t.plugin === CALENDAR_PLUGIN);
  const eventType = calendar[0]?.type;
  // The calendar's own page, while its plugin is on (data.events is null when it is off).
  const allEvents = data.events !== null ? calendar.find((t) => t.section)?.section?.path : undefined;
  // Read when the data arrives; the rows don't tick while the page is open.
  const [now] = useState(() => Date.now());
  // The calendar's events only (Events 4): closing dates are feed cards now.
  const rows = comingUpRows({
    events: data.events,
    eventPath: (id) => (eventType ? detailPathOf(eventType, id) : `/process/${id}`),
    hubTimeZone: hub.timeZone,
    now,
  });
  if (rows.length === 0) return null;
  return (
    <AsideCard id="coming_up" title="Coming up">
      <ul className="aside-rows">
        {rows.map((r) => {
          const tile = dateTile(r.at, r.timeZone);
          return (
            <li key={r.key}>
              <Link to={r.url} className="aside-row">
                <span className="aside-date" aria-hidden="true">
                  <span className="aside-date-month">{tile.month}</span>
                  <span className="aside-date-day">{tile.day}</span>
                </span>
                <span className="aside-row-text">
                  <span className="aside-row-title">{r.title}</span>
                  <span className="aside-row-meta">
                    <span className="visually-hidden">
                      {tile.month} {tile.day},{" "}
                    </span>
                    {timeOfDay(r.at, r.timeZone)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {allEvents && (
        <Link to={allEvents} className="aside-card-more">
          See all events
        </Link>
      )}
    </AsideCard>
  );
}

export function AnnouncementsCard({ data }: { data: AsideData }) {
  const list = data.facts?.announcements ?? [];
  if (list.length === 0) return null;
  return (
    <AsideCard id="announcements" title="Announcements">
      <ul className="aside-rows aside-rows--plain">
        {list.map((a) => (
          <li key={a.process_id}>
            <Link to={a.url} className="aside-row aside-row--plain">
              <span className="aside-row-text">
                <span className="aside-row-title">{a.title}</span>
                <span className="aside-row-meta">{localShortDate(a.published_at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AsideCard>
  );
}

export function AboutCard({ data }: { data: AsideData }) {
  const hub = useHub();
  const { user, loading } = useAuth();
  const [joining, setJoining] = useState(false);
  const count = data.facts?.about.member_count ?? null;
  return (
    <AsideCard id="about" title={`About ${hub.isPlace ? hub.jurisdiction : hub.name}`}>
      <p className="aside-about-line">
        {hub.label}
        {hub.location && ` · ${hub.location}`}
      </p>
      {count !== null && (
        <p className="aside-about-line aside-about-count">
          {count.toLocaleString("en-US")} {count === 1 ? "member" : "members"}
        </p>
      )}
      <div className="aside-about-actions">
        {!loading && !user && (
          <Button variant="primary" size="sm" onClick={() => setJoining(true)}>
            Join or sign in
          </Button>
        )}
        <Link to="/about" className="aside-about-link">
          About this hub
        </Link>
      </div>
      {joining && <AuthModal onComplete={() => setJoining(false)} onDismiss={() => setJoining(false)} />}
    </AsideCard>
  );
}
