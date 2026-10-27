// Events' UI module: the calendar, an event's page, and the forms to propose
// and change one. Its own React components, using the React the hub runs and
// the hub's theme variables; it reads and acts through the hub's routes for
// every process (/process/:id/state, /process/:id/action), the hub's drafts
// routes at /calendar/drafts, and its own /calendar routes.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ProcessUi } from "@civic-social/plugin-sdk/ui";
import { locationLine, type EventLocation } from "./event";
import "./styles.css";

// --- Reading and acting through the hub ---------------------------------------

function authHeaders(): Record<string, string> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("civic_auth_token");
  } catch {
    token = null;
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const signedIn = () => Boolean(authHeaders().Authorization);

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "Something went wrong. Try again.");
  return body as T;
}

/** Whether the reader is one of the hub's admins (for edit and cancel). */
function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!signedIn()) return;
    api<{ role: string | null }>("/auth/me").then((me) => setAdmin(me.role === "admin"), () => setAdmin(false));
  }, []);
  return admin;
}

interface CalendarEvent {
  process_id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  location: EventLocation;
  cancelled: boolean;
}

interface EventView {
  id: string;
  title: string;
  description: string;
  status: string;
  start_time: string;
  end_time: string;
  location: EventLocation;
  cancelled: { at: string; reason: string } | null;
  going_count: number;
  is_going: boolean;
  is_creator: boolean;
}

// --- Dates, in the reader's own time zone ------------------------------------

const dayKey = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
const dayHeading = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function whenLine(start: string, end: string): string {
  return dayKey(start) === dayKey(end)
    ? `${dayHeading(start)}, ${timeOf(start)} – ${timeOf(end)}`
    : `${dayHeading(start)}, ${timeOf(start)} – ${dayHeading(end)}, ${timeOf(end)}`;
}

/** An ISO instant as a datetime-local value, in the reader's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value as an ISO instant (the reader's time zone), or null. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// --- Pieces -------------------------------------------------------------------

/** A slim bar for the forms: back, and what the page is. */
function SlimHeader({ back, title }: { back: string; title: string }) {
  return (
    <div className="ev-slim">
      <Link to={back} className="ev-slim-back" aria-label="Back">
        ‹
      </Link>
      <h1 className="ev-slim-title">{title}</h1>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="ev-pill">{children}</span>;
}

function Where({ location }: { location: EventLocation }) {
  if (location.type === "Link") {
    return (
      <a href={location.href} target="_blank" rel="noopener noreferrer">
        Online: {new URL(location.href).host}
      </a>
    );
  }
  return <span>{locationLine(location)}</span>;
}

// --- The calendar ------------------------------------------------------------------

function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ events: CalendarEvent[] }>("/calendar/events").then((r) => setEvents(r.events), (e: Error) => setError(e.message));
  }, []);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const all = events ?? [];
    return {
      upcoming: all.filter((e) => Date.parse(e.end_time) > now),
      past: all.filter((e) => Date.parse(e.end_time) <= now).reverse(),
    };
  }, [events]);

  const byDay = useMemo(() => {
    const groups: Array<{ key: string; heading: string; events: CalendarEvent[] }> = [];
    for (const e of upcoming) {
      const key = dayKey(e.start_time);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(e);
      else groups.push({ key, heading: dayHeading(e.start_time), events: [e] });
    }
    return groups;
  }, [upcoming]);

  return (
    <main className="ev-page">
      <div className="ev-head">
        <h1>Events</h1>
        {signedIn() && (
          <Link to="/events/new" className="ev-button ev-button--primary">
            Add an event
          </Link>
        )}
      </div>
      <p className="ev-muted">
        <a href="/api/calendar/hub.ics">Subscribe in your calendar app</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {!events && !error && <p className="ev-muted">Loading…</p>}
      {events && upcoming.length === 0 && <p className="ev-muted">Nothing is on the calendar yet.</p>}
      {byDay.map((g) => (
        <section key={g.key} className="ev-day" aria-label={g.heading}>
          <h2 className="ev-day-heading">{g.heading}</h2>
          <ul className="ev-list">
            {g.events.map((e) => (
              <CalendarItem key={e.process_id} event={e} />
            ))}
          </ul>
        </section>
      ))}
      {past.length > 0 && (
        <details className="ev-past">
          <summary>Past events ({past.length})</summary>
          <ul className="ev-list">
            {past.map((e) => (
              <CalendarItem key={e.process_id} event={e} showDay />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

function CalendarItem({ event, showDay }: { event: CalendarEvent; showDay?: boolean }) {
  return (
    <li className={`ev-item${event.cancelled ? " is-cancelled" : ""}`}>
      <Link to={`/events/${event.process_id}`} className="ev-item-link">
        <span className="ev-item-time">
          {showDay ? `${dayHeading(event.start_time)}, ` : ""}
          {timeOf(event.start_time)}
        </span>
        <span className="ev-item-title">
          {event.title} {event.cancelled && <Pill>Cancelled</Pill>}
        </span>
        <span className="ev-item-where">
          {event.location.type === "Link" ? "Online" : locationLine(event.location)}
        </span>
      </Link>
    </li>
  );
}

// --- An event -------------------------------------------------------------------

function EventPage() {
  const { id } = useParams();
  const isAdmin = useIsAdmin();
  const [event, setEvent] = useState<EventView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const load = () =>
    api<EventView>(`/process/${id}/state`).then(setEvent, (e: Error) => setMessage(e.message));
  useEffect(() => {
    void load();
  }, [id]);

  async function act(type: string, payload: Record<string, unknown> = {}, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/process/${id}/action`, { method: "POST", body: { type, payload } });
      if (done) setMessage(done);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!event) return <main className="ev-page">{message ? <p role="alert">{message}</p> : <p className="ev-muted">Loading…</p>}</main>;
  const upcoming = event.status === "active";
  const canChange = upcoming && (event.is_creator || isAdmin);

  return (
    <main className="ev-page">
      <p className="ev-crumb">
        <Link to="/events">‹ Events</Link>
      </p>
      <Pill>Event</Pill>
      <h1 className="ev-title">{event.title}</h1>
      {event.cancelled && (
        <p className="ev-cancelled" role="status">
          This event was cancelled.{event.cancelled.reason ? ` ${event.cancelled.reason}` : ""}
        </p>
      )}
      {!event.cancelled && !upcoming && <p className="ev-muted">This event has ended.</p>}
      <dl className="ev-facts">
        <dt>When</dt>
        <dd>{whenLine(event.start_time, event.end_time)}</dd>
        <dt>Where</dt>
        <dd>
          <Where location={event.location} />
        </dd>
        <dt>Going</dt>
        <dd data-testid="going-count">
          {event.going_count === 1 ? "1 person is going" : `${event.going_count} people are going`}
        </dd>
      </dl>
      {event.description && <p className="ev-description">{event.description}</p>}

      {upcoming && signedIn() && (
        <div className="ev-actions">
          {event.is_going ? (
            <button type="button" className="ev-button" disabled={busy} onClick={() => act("not_going")}>
              I'm not going
            </button>
          ) : (
            <button type="button" className="ev-button ev-button--primary" disabled={busy} onClick={() => act("going", {}, "You're going.")}>
              I'm going
            </button>
          )}
        </div>
      )}
      {upcoming && !signedIn() && <p className="ev-muted">Sign in to say you're going.</p>}

      {canChange && (
        <div className="ev-actions ev-actions--secondary">
          <Link to={`/events/${event.id}/edit`} className="ev-button">
            Change time or place
          </Link>
          {!cancelling && (
            <button type="button" className="ev-button ev-button--danger" onClick={() => setCancelling(true)}>
              Cancel event
            </button>
          )}
        </div>
      )}
      {cancelling && (
        <form
          className="ev-form ev-cancel"
          onSubmit={(e) => {
            e.preventDefault();
            void act("cancel", { reason }, "The event is cancelled. It stays on the calendar, marked cancelled.");
            setCancelling(false);
          }}
        >
          <label>
            Why (optional, shown on the event)
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="ev-actions">
            <button type="submit" className="ev-button ev-button--danger" disabled={busy}>
              Cancel the event
            </button>
            <button type="button" className="ev-button" onClick={() => setCancelling(false)}>
              Keep it
            </button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}

// --- Proposing and changing one ---------------------------------------------------

interface WhereFields {
  mode: "place" | "online";
  venue: string;
  street_address: string;
  locality: string;
  region: string;
  postal_code: string;
  country: string;
  online_url: string;
}

const EMPTY_WHERE: WhereFields = { mode: "place", venue: "", street_address: "", locality: "", region: "", postal_code: "", country: "", online_url: "" };

function whereFieldsOf(location: EventLocation): WhereFields {
  if (location.type === "Link") return { ...EMPTY_WHERE, mode: "online", online_url: location.href };
  const a = location.address ?? { type: "PostalAddress" as const };
  return {
    ...EMPTY_WHERE,
    venue: location.name,
    street_address: a.streetAddress ?? "",
    locality: a.addressLocality ?? "",
    region: a.addressRegion ?? "",
    postal_code: a.postalCode ?? "",
    country: a.addressCountry ?? "",
  };
}

/** The draft's location fields: a place and its address, or an online link. */
function whereBody(w: WhereFields): Record<string, string | null> {
  const v = (s: string) => s.trim() || null;
  return w.mode === "online"
    ? { venue: null, street_address: null, locality: null, region: null, postal_code: null, country: null, online_url: v(w.online_url) }
    : {
        venue: v(w.venue),
        street_address: v(w.street_address),
        locality: v(w.locality),
        region: v(w.region),
        postal_code: v(w.postal_code),
        country: v(w.country),
        online_url: null,
      };
}

/** The stored location shape an edit sends. */
function whereLocation(w: WhereFields): EventLocation {
  if (w.mode === "online") return { type: "Link", name: "Online", href: w.online_url.trim() };
  const address = {
    type: "PostalAddress" as const,
    ...(w.street_address.trim() ? { streetAddress: w.street_address.trim() } : {}),
    ...(w.locality.trim() ? { addressLocality: w.locality.trim() } : {}),
    ...(w.region.trim() ? { addressRegion: w.region.trim() } : {}),
    ...(w.postal_code.trim() ? { postalCode: w.postal_code.trim() } : {}),
    ...(w.country.trim() ? { addressCountry: w.country.trim() } : {}),
  };
  return Object.keys(address).length > 1 ? { type: "Place", name: w.venue.trim(), address } : { type: "Place", name: w.venue.trim() };
}

function WhenWhere({
  start,
  end,
  where,
  onStart,
  onEnd,
  onWhere,
}: {
  start: string;
  end: string;
  where: WhereFields;
  onStart(v: string): void;
  onEnd(v: string): void;
  onWhere(w: WhereFields): void;
}) {
  const set = (k: keyof WhereFields) => (e: { target: { value: string } }) => onWhere({ ...where, [k]: e.target.value });
  return (
    <>
      <div className="ev-row">
        <label>
          Starts
          <input type="datetime-local" required value={start} onChange={(e) => onStart(e.target.value)} />
        </label>
        <label>
          Ends
          <input type="datetime-local" required value={end} onChange={(e) => onEnd(e.target.value)} />
        </label>
      </div>
      <fieldset className="ev-where">
        <legend>Where</legend>
        <div className="ev-toggle" role="radiogroup" aria-label="Where">
          <label>
            <input type="radio" name="where" checked={where.mode === "place"} onChange={() => onWhere({ ...where, mode: "place" })} /> A place
          </label>
          <label>
            <input type="radio" name="where" checked={where.mode === "online"} onChange={() => onWhere({ ...where, mode: "online" })} /> Online
          </label>
        </div>
        {where.mode === "place" ? (
          <>
            <label>
              Place
              <input required maxLength={120} placeholder="The room or building" value={where.venue} onChange={set("venue")} />
            </label>
            <details className="ev-address" open={Boolean(where.street_address || where.locality)}>
              <summary>Street address (helps maps and calendars)</summary>
              <label>
                Street
                <input maxLength={120} autoComplete="street-address" value={where.street_address} onChange={set("street_address")} />
              </label>
              <div className="ev-row">
                <label>
                  Town or city
                  <input maxLength={120} autoComplete="address-level2" value={where.locality} onChange={set("locality")} />
                </label>
                <label>
                  Region
                  <input maxLength={120} autoComplete="address-level1" value={where.region} onChange={set("region")} />
                </label>
              </div>
              <div className="ev-row">
                <label>
                  Postal code
                  <input maxLength={120} autoComplete="postal-code" value={where.postal_code} onChange={set("postal_code")} />
                </label>
                <label>
                  Country
                  <input maxLength={120} autoComplete="country-name" value={where.country} onChange={set("country")} />
                </label>
              </div>
            </details>
          </>
        ) : (
          <label>
            Link
            <input type="url" required placeholder="https://" value={where.online_url} onChange={set("online_url")} />
          </label>
        )}
      </fieldset>
    </>
  );
}

interface SubmitResult {
  process_id?: string;
  auto_approved?: boolean;
  flagged?: boolean;
}

interface DraftView {
  id: string;
  title: string;
  description: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  street_address: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  online_url: string | null;
}

function NewEventPage() {
  const navigate = useNavigate();
  // "Edit & resubmit" after an admin asked for changes: the draft, and the review it revises.
  const [params] = useSearchParams();
  const reviewId = params.get("review");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [where, setWhere] = useState<WhereFields>(EMPTY_WHERE);
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    const id = params.get("draft");
    if (!id || !signedIn()) return;
    api<DraftView>(`/calendar/drafts/${encodeURIComponent(id)}`).then(
      (d) => {
        setTitle(d.title);
        setDescription(d.description);
        setStart(toLocalInput(d.start_time));
        setEnd(toLocalInput(d.end_time));
        const w = (v: string | null) => v ?? "";
        setWhere(
          d.online_url
            ? { ...EMPTY_WHERE, mode: "online", online_url: d.online_url }
            : {
                ...EMPTY_WHERE,
                venue: w(d.venue),
                street_address: w(d.street_address),
                locality: w(d.locality),
                region: w(d.region),
                postal_code: w(d.postal_code),
                country: w(d.country),
              },
        );
      },
      (e: Error) => setError(e.message),
    );
  }, [params]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The hub's drafts routes: make the draft once, fill it, submit it. A
      // refusal keeps the draft, so pressing Submit again reuses it.
      const id = draftId ?? (await api<{ id: string }>("/calendar/drafts", { method: "POST", body: {} })).id;
      setDraftId(id);
      await api(`/calendar/drafts/${id}`, {
        method: "PATCH",
        body: { title, description, start_time: fromLocalInput(start), end_time: fromLocalInput(end), ...whereBody(where) },
      });
      const result = await api<SubmitResult>(`/calendar/drafts/${id}/submit`, {
        method: "POST",
        body: reviewId ? { review_id: reviewId } : {},
      });
      if (result.auto_approved && result.process_id) navigate(`/events/${result.process_id}`);
      else setQueued(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn()) {
    return (
      <main className="ev-page">
        <SlimHeader back="/events" title="New event" />
        <p>Sign in to add an event to the calendar.</p>
      </main>
    );
  }
  if (queued) {
    return (
      <main className="ev-page">
        <SlimHeader back="/events" title="New event" />
        <p role="status">Thank you. Your event is with the hub's admins, and goes on the calendar once they approve it.</p>
        <Link to="/events">Back to the calendar</Link>
      </main>
    );
  }
  return (
    <main className="ev-page ev-page--form">
      <SlimHeader back="/events" title="New event" />
      <form className="ev-form" onSubmit={submit}>
        <label>
          Name
          <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          What it is
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <WhenWhere start={start} end={end} where={where} onStart={setStart} onEnd={setEnd} onWhere={setWhere} />
        {error && <p role="alert" className="ev-error">{error}</p>}
        <div className="ev-actions">
          <button type="submit" className="ev-button ev-button--primary" disabled={busy}>
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </form>
    </main>
  );
}

function EditEventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventView | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [where, setWhere] = useState<WhereFields>(EMPTY_WHERE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<EventView>(`/process/${id}/state`).then(
      (e) => {
        setEvent(e);
        setStart(toLocalInput(e.start_time));
        setEnd(toLocalInput(e.end_time));
        setWhere(whereFieldsOf(e.location));
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/process/${id}/action`, {
        method: "POST",
        body: { type: "edit", payload: { start_time: fromLocalInput(start), end_time: fromLocalInput(end), location: whereLocation(where) } },
      });
      navigate(`/events/${id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ev-page ev-page--form">
      <SlimHeader back={`/events/${id}`} title="Change time or place" />
      {!event && !error && <p className="ev-muted">Loading…</p>}
      {event && (
        <form className="ev-form" onSubmit={save}>
          <p className="ev-muted">{event.title}</p>
          <WhenWhere start={start} end={end} where={where} onStart={setStart} onEnd={setEnd} onWhere={setWhere} />
          <div className="ev-actions">
            <button type="submit" className="ev-button ev-button--primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="ev-error">{error}</p>}
    </main>
  );
}

/** The feed's card when an event goes on the calendar: when and where, from its own payload. */
function eventCard({ data, id, getTitle }: { data: Record<string, unknown>; id: string; getTitle: (id: string) => string | undefined }) {
  const p = (data.process ?? {}) as { title?: string; event?: { start_time?: string; end_time?: string; location?: EventLocation } };
  const ev = p.event;
  const when = ev?.start_time && ev.end_time ? whenLine(ev.start_time, ev.end_time) : "";
  const where = ev?.location ? (ev.location.type === "Link" ? "Online" : locationLine(ev.location)) : "";
  return {
    title: p.title ?? getTitle(id) ?? "New event",
    summary: [when, where].filter(Boolean).join(" · ") || "A new event is on the calendar.",
  };
}

const eventsUi: ProcessUi = {
  type: "civic.event",
  routes: [
    { path: "/events", element: <CalendarPage /> },
    { path: "/events/new", element: <NewEventPage /> },
    { path: "/events/:id", element: <EventPage /> },
    { path: "/events/:id/edit", element: <EditEventPage /> },
  ],
  feed: { event: { card: eventCard } },
};

export default eventsUi;
