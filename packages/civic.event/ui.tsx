// Events' UI module: the calendar, an event's page, and the form to propose
// and edit one. Drawn with the hub's UI kit (@civic-social/plugin-sdk/ui:
// its buttons, fields and drafting shell; engine 2, A7), so it looks like the
// hub's own pages; it reads and acts through the hub's routes for every
// process (/process/:id/state, /process/:id/action, /process/:id/edit), the
// hub's drafts routes at /calendar/drafts, and its own /calendar routes.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, DateTimeInput, DraftShell, Field, Select, TextArea, TextInput, type ProcessUi } from "@civic-social/plugin-sdk/ui";
import {
  ALT_MAX,
  CAPACITY_MAX,
  MESSAGE_MAX,
  SUBJECT_MAX,
  defaultEnd,
  durationMinutes,
  endAfter,
  formatDuration,
  locationLine,
  parseDuration,
  type EventImage,
  type EventLocation,
} from "./event";
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

/** The reader's own zone, as the browser has it. */
const readerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * The hub's time zone (its public identity.timezone; Events 2, E3): what a new
 * event's times are given in unless its proposer picks another, and what an
 * event from before 0.3.0 reads in. The reader's until it has loaded.
 */
function useHubZone(): string {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    api<{ settings?: Record<string, string> }>("/hub-config").then(
      (c) => setZone(c.settings?.["identity.timezone"] || "UTC"),
      () => setZone(null),
    );
  }, []);
  return zone ?? readerZone();
}

/** Every zone the browser knows, the chosen one first if it doesn't. */
function zoneChoices(current: string): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return all.includes(current) ? all : [current, ...all];
}

interface CalendarEvent {
  process_id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  location: EventLocation;
  cancelled: boolean;
  image_url: string | null;
  image_alt: string | null;
  time_zone: string | null;
  capacity: number | null;
}

interface Announcement {
  id: string;
  kind: "announcement" | "change";
  subject: string;
  body: string;
  created_at: string;
  /** To its creator only: how many it was for, and reached. */
  recipients?: number;
  sent?: number;
  held_back?: number;
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
  /** 0.3.0: its zone (the hub's for an older event), its picture, its limit. */
  time_zone: string;
  image: EventImage | null;
  capacity: number | null;
  spots_left: number | null;
  /** To the people going and its creator; null for anyone else. */
  announcements: Announcement[] | null;
  /** Its own status word (scheduled, past, cancelled), from its manifest (A4). */
  type_status?: { id: string; label: string };
}

// --- Dates: in the event's own zone (0.3.0), the reader's when none is given ---

const dayKey = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const dayHeading = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeOf = (iso: string, timeZone?: string, named = false) =>
  new Date(iso).toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit", ...(named ? { timeZoneName: "short" as const } : {}) });

/** "Saturday, June 1, 2030, 7:00 PM – 9:00 PM", the zone named when one is given. */
function whenLine(start: string, end: string, timeZone?: string): string {
  const named = Boolean(timeZone);
  return dayKey(start, timeZone) === dayKey(end, timeZone)
    ? `${dayHeading(start, timeZone)}, ${timeOf(start, timeZone)} – ${timeOf(end, timeZone, named)}`
    : `${dayHeading(start, timeZone)}, ${timeOf(start, timeZone)} – ${dayHeading(end, timeZone)}, ${timeOf(end, timeZone, named)}`;
}

/** Whether a reader's clock shows a different hour from the event's zone. */
const sameClock = (iso: string, a: string, b: string) => timeOf(iso, a, true) === timeOf(iso, b, true);

// --- Pieces -------------------------------------------------------------------

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
  const hubZone = useHubZone();
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
      const zone = e.time_zone ?? hubZone;
      const key = dayKey(e.start_time, zone);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(e);
      else groups.push({ key, heading: dayHeading(e.start_time, zone), events: [e] });
    }
    return groups;
  }, [upcoming, hubZone]);

  return (
    <main className="ev-page">
      <div className="ev-head">
        <h1>Events</h1>
        {signedIn() && (
          <Link to="/events/new" className="btn-primary">
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
              <CalendarItem key={e.process_id} event={e} zone={e.time_zone ?? hubZone} />
            ))}
          </ul>
        </section>
      ))}
      {past.length > 0 && (
        <details className="ev-past">
          <summary>Past events ({past.length})</summary>
          <ul className="ev-list">
            {past.map((e) => (
              <CalendarItem key={e.process_id} event={e} zone={e.time_zone ?? hubZone} showDay />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

function CalendarItem({ event, zone, showDay }: { event: CalendarEvent; zone: string; showDay?: boolean }) {
  // The zone named only when it is not the reader's own.
  const named = !sameClock(event.start_time, zone, readerZone());
  return (
    <li className={`ev-item${event.cancelled ? " is-cancelled" : ""}`}>
      <Link to={`/events/${event.process_id}`} className="ev-item-link">
        <span className="ev-item-time">
          {showDay ? `${dayHeading(event.start_time, zone)}, ` : ""}
          {timeOf(event.start_time, zone, named)}
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
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [event, setEvent] = useState<EventView | null>(null);
  const [going, setGoing] = useState<{ count: number; names: string[] | null } | null>(null);
  const [adminLog, setAdminLog] = useState<Announcement[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const load = () => {
    void api<EventView>(`/process/${id}/state`).then(setEvent, (e: Error) => setMessage(e.message));
    // Who is going, as the hub discloses it: names to members, the count to everyone (A3).
    void api<{ count: number; names: string[] | null }>(`/calendar/events/${id}/going`).then(setGoing, () => setGoing(null));
  };
  useEffect(() => {
    load();
    // Whether this reader may edit it: the hub's edit policy (the creator, or an admin).
    if (signedIn()) api<{ editable: boolean }>(`/process/${id}/edit-policy`).then((p) => setEditable(p.editable), () => setEditable(false));
  }, [id]);
  // An admin who is not going reads the messages from the admins' route.
  useEffect(() => {
    if (isAdmin && event && event.announcements === null) {
      api<{ announcements: Announcement[] }>(`/calendar/events/${id}/announcements`).then((r) => setAdminLog(r.announcements), () => setAdminLog(null));
    }
  }, [isAdmin, event, id]);

  async function act(type: string, payload: Record<string, unknown> = {}, done?: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/process/${id}/action`, { method: "POST", body: { type, payload } });
      if (done) setMessage(done);
      load();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  // "Edit event": the hub's edit path opens the form on a draft of the event as published (A1).
  async function edit() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ draft_path: string }>(`/process/${id}/edit`, { method: "POST", body: {} });
      navigate(r.draft_path);
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }

  if (!event) return <main className="ev-page">{message ? <p role="alert">{message}</p> : <p className="ev-muted">Loading…</p>}</main>;
  const upcoming = event.status === "active";
  const organiser = event.is_creator || isAdmin;
  const canCancel = upcoming && organiser;
  const count = going?.count ?? event.going_count;
  const zone = event.time_zone;
  const mine = readerZone();
  const log = event.announcements ?? adminLog;

  return (
    <main className="ev-page">
      <p className="ev-crumb">
        <Link to="/events">‹ Events</Link>
      </p>
      {event.image && (
        <img className="ev-image" src={event.image.url} alt={event.image.alt} data-testid="event-image" />
      )}
      <Pill>{event.type_status && event.type_status.id !== "scheduled" ? `Event · ${event.type_status.label}` : "Event"}</Pill>
      <h1 className="ev-title">{event.title}</h1>
      {event.cancelled && (
        <p className="ev-cancelled" role="status">
          This event was cancelled.{event.cancelled.reason ? ` ${event.cancelled.reason}` : ""}
        </p>
      )}
      {!event.cancelled && !upcoming && <p className="ev-muted">This event has ended.</p>}
      <dl className="ev-facts">
        <dt>When</dt>
        <dd data-testid="event-when">{whenLine(event.start_time, event.end_time, zone)}</dd>
        {!sameClock(event.start_time, zone, mine) && (
          <dd className="ev-muted ev-facts-more" data-testid="event-when-mine">
            Your time: {whenLine(event.start_time, event.end_time, mine)}
          </dd>
        )}
        <dt>Where</dt>
        <dd>
          <Where location={event.location} />
        </dd>
        <dt>Going</dt>
        <dd data-testid="going-count">{goingLine(count, event.capacity, event.spots_left)}</dd>
        {going?.names && going.names.length > 0 && (
          <dd className="ev-going-names" data-testid="going-names">
            {going.names.join(", ")}
          </dd>
        )}
      </dl>
      {event.description && <p className="ev-description">{event.description}</p>}

      {upcoming && signedIn() && (
        <RsvpControl
          going={event.is_going}
          full={event.spots_left === 0}
          count={count}
          busy={busy}
          onGoing={() => void act("going", {}, "You're going.")}
          onNotGoing={() => void act("not_going", {}, "You're not going.")}
        />
      )}
      {upcoming && !signedIn() && <p className="ev-muted">Sign in to say you're going.</p>}

      <p className="ev-calendar-links">
        <a href={`/api/calendar/events/${encodeURIComponent(event.id)}.ics`} download data-testid="add-to-calendar">
          Add to my calendar
        </a>
      </p>

      {(editable || canCancel) && (
        <div className="ev-actions ev-actions--secondary">
          {editable && (
            <Button disabled={busy} onClick={() => void edit()}>
              Edit event
            </Button>
          )}
          {canCancel && !cancelling && (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              Cancel event
            </Button>
          )}
        </div>
      )}
      {cancelling && (
        <form
          className="ev-form ev-cancel"
          onSubmit={(e) => {
            e.preventDefault();
            void act("cancel", { reason }, "The event is cancelled. It stays on the calendar, marked cancelled, and the people going are told.");
            setCancelling(false);
          }}
        >
          <p>
            Cancel {event.title}? {count > 0 ? `The ${count === 1 ? "person" : `${count} people`} going will be told.` : ""} This can't be undone.
          </p>
          <Field label="Why (shown on the event and in the message)" optional htmlFor="ev-cancel-reason">
            <TextArea id="ev-cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="ev-actions">
            <Button type="submit" variant="danger" disabled={busy}>
              Yes, cancel the event
            </Button>
            <Button onClick={() => setCancelling(false)}>Keep it</Button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}

      {upcoming && organiser && <AnnouncePanel count={event.is_going ? count - 1 : count} busy={busy} onSend={(payload) => act("announce", payload)} />}
      {log && log.length > 0 && <AnnouncementLog log={log} organiser={event.is_creator} />}
    </main>
  );
}

/** "12 people are going", or with a limit "12 going · 28 places left", or "Full · 40 going". */
function goingLine(count: number, capacity: number | null, spotsLeft: number | null): string {
  if (capacity === null || spotsLeft === null) return count === 1 ? "1 person is going" : `${count} people are going`;
  if (spotsLeft === 0) return `Full · ${count} going`;
  return `${count} going · ${spotsLeft} ${spotsLeft === 1 ? "place" : "places"} left`;
}

/**
 * Whether you are going (Events 2, 7): the state, ticked, and the other
 * choice beside it, the same for everyone, its creator too. Not answered yet:
 * the one action. At its limit, someone not going sees that it is full.
 */
function RsvpControl({
  going,
  full,
  count,
  busy,
  onGoing,
  onNotGoing,
}: {
  going: boolean;
  full: boolean;
  count: number;
  busy: boolean;
  onGoing(): void;
  onNotGoing(): void;
}) {
  if (going) {
    return (
      <div className="ev-rsvp" role="group" aria-label="Are you going?" data-testid="rsvp">
        <button type="button" className="ev-rsvp-choice is-chosen" aria-pressed="true" disabled={busy}>
          <span aria-hidden="true">✓ </span>You're going
        </button>
        <button type="button" className="ev-rsvp-choice" aria-pressed="false" disabled={busy} onClick={onNotGoing}>
          Not going
        </button>
      </div>
    );
  }
  if (full) {
    return (
      <div className="ev-rsvp" data-testid="rsvp">
        <Button disabled aria-disabled="true">
          Full · {count} going
        </Button>
      </div>
    );
  }
  return (
    <div className="ev-rsvp" data-testid="rsvp">
      <Button variant="primary" disabled={busy} onClick={onGoing}>
        I'm going
      </Button>
    </div>
  );
}

/** A message to everyone going, from its creator or an admin: by email, through the hub. */
function AnnouncePanel({ count, busy, onSend }: { count: number; busy: boolean; onSend(p: { subject: string; message: string }): Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  if (!open) {
    return (
      <div className="ev-actions ev-actions--secondary">
        <Button onClick={() => setOpen(true)} disabled={count < 1} title={count < 1 ? "Nobody else is going yet." : undefined}>
          Message the people going
        </Button>
      </div>
    );
  }
  return (
    <form
      className="ev-form ev-announce"
      aria-label="Message the people going"
      onSubmit={(e) => {
        e.preventDefault();
        void onSend({ subject, message: text }).then((ok) => {
          if (ok) {
            setOpen(false);
            setSubject("");
            setText("");
          }
        });
      }}
    >
      <p className="ev-muted">
        To the {count === 1 ? "person" : `${count} people`} going, by email from the hub. Their addresses stay with the hub.
      </p>
      <Field label="Subject" required htmlFor="ev-ann-subject">
        <TextInput id="ev-ann-subject" required maxLength={SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message" required htmlFor="ev-ann-message">
        <TextArea id="ev-ann-message" required rows={5} maxLength={MESSAGE_MAX} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="ev-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Send
        </Button>
        <Button onClick={() => setOpen(false)}>Not now</Button>
      </div>
    </form>
  );
}

/** What the people going were sent: its own messages, and what changed. */
function AnnouncementLog({ log, organiser }: { log: Announcement[]; organiser: boolean }) {
  return (
    <section className="ev-announcements" aria-labelledby="ev-ann-heading" data-testid="announcements">
      <h2 id="ev-ann-heading" className="ev-section-heading">
        From the organiser
      </h2>
      <ul className="ev-list">
        {log.map((a) => (
          <li key={a.id} className="ev-announcement">
            <p className="ev-announcement-subject">
              {a.kind === "change" && <Pill>Change</Pill>} {a.subject}
            </p>
            <p className="ev-announcement-body">{a.body}</p>
            <p className="ev-muted">
              {new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {organiser && a.recipients !== undefined && ` · to ${a.recipients}, emailed ${a.sent}${a.held_back ? `, ${a.held_back} held back by the hub's mode` : ""}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Proposing and editing one --------------------------------------------------

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

/**
 * When it is (Events 2, 2 and 3): the start, the end and how long it runs,
 * kept together, all in the event's zone. Choosing a start fills the end an
 * hour after it, the same day (or keeps how long it runs when one is set);
 * a duration moves the end; an end moves the duration.
 */
function When({
  start,
  end,
  zone,
  onTimes,
  onZone,
}: {
  start: string | null;
  end: string | null;
  zone: string;
  onTimes(start: string | null, end: string | null): void;
  onZone(zone: string): void;
}) {
  const minutes = durationMinutes(start, end);
  const [duration, setDuration] = useState(minutes ? formatDuration(minutes) : "");
  const [durationError, setDurationError] = useState<string | null>(null);
  // An end changed elsewhere (picked, or loaded from a draft) shows its duration.
  useEffect(() => {
    if (minutes !== parseDuration(duration)) setDuration(minutes ? formatDuration(minutes) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  function startChanged(next: string | null) {
    if (!next) return onTimes(null, end);
    const keep = durationMinutes(start, end);
    onTimes(next, keep ? endAfter(next, keep) : !end || Date.parse(end) <= Date.parse(next) ? defaultEnd(next, zone) : end);
  }

  function durationChanged(text: string) {
    setDuration(text);
    const m = parseDuration(text);
    setDurationError(text.trim() && !m ? "Say how long, like 90 min, 1 h 30 min or 2 hours." : null);
    if (m && start) onTimes(start, endAfter(start, m));
  }

  return (
    <>
      <div className="ev-row ev-row--three">
        <Field label="Starts" required htmlFor="ev-start">
          <DateTimeInput id="ev-start" required value={start} timeZone={zone} onChange={startChanged} />
        </Field>
        <Field label="Ends" required htmlFor="ev-end">
          <DateTimeInput id="ev-end" required value={end} timeZone={zone} onChange={(v) => onTimes(start, v)} />
        </Field>
        <Field label="Duration" htmlFor="ev-duration" hint={durationError ?? undefined}>
          <TextInput
            id="ev-duration"
            inputMode="text"
            placeholder="1 h"
            value={duration}
            aria-invalid={durationError ? true : undefined}
            onChange={(e) => durationChanged(e.target.value)}
            onBlur={() => !durationError && minutes && setDuration(formatDuration(minutes))}
          />
        </Field>
      </div>
      <Field label="Time zone" htmlFor="ev-zone" hint="The times above are in this zone. Readers elsewhere also see their own time.">
        <Select id="ev-zone" value={zone} onChange={(e) => onZone(e.target.value)}>
          {zoneChoices(zone).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * Its picture (Events 2, 1): uploaded through the hub's route for this type,
 * made smaller in the browser first when it is large (as the hub's composers
 * do), with what it shows for people who can't see it.
 */
function Picture({ image, onImage }: { image: EventImage | null; onImage(i: EventImage | null): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chosen(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", await smaller(file), file.name);
      const r = await fetch("/api/upload/process-image/civic.event", { method: "POST", headers: authHeaders(), body });
      const out = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !out.url) throw new Error(out.error ?? "That picture couldn't be uploaded. Try another.");
      onImage({ url: out.url, alt: image?.alt ?? "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="ev-picture">
      <legend className="form-label">
        Picture <span className="optional">(optional)</span>
      </legend>
      {image ? (
        <>
          <img className="ev-image ev-image--preview" src={image.url} alt={image.alt} data-testid="picture-preview" />
          <Field label="What the picture shows" hint="For people who can't see it." htmlFor="ev-alt">
            <TextInput id="ev-alt" maxLength={ALT_MAX} value={image.alt} onChange={(e) => onImage({ ...image, alt: e.target.value })} />
          </Field>
          <Button onClick={() => onImage(null)}>Remove the picture</Button>
        </>
      ) : (
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          aria-label="Choose a picture"
          disabled={busy}
          data-testid="picture-input"
          onChange={(e) => void chosen(e.target.files?.[0])}
        />
      )}
      {busy && <p className="ev-muted">Uploading…</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

/** At most 2000 px on the long edge and re-encoded as WebP when larger; small files as they are. */
async function smaller(file: File): Promise<Blob> {
  if (file.type === "image/gif" || file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/webp", 0.85));
}

function WhenWhere({
  where,
  onWhere,
}: {
  where: WhereFields;
  onWhere(w: WhereFields): void;
}) {
  const set = (k: keyof WhereFields) => (e: { target: { value: string } }) => onWhere({ ...where, [k]: e.target.value });
  return (
    <>
      <fieldset className="ev-where">
        <legend className="form-label">Where</legend>
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
            <Field label="Place" required htmlFor="ev-venue">
              <TextInput id="ev-venue" required maxLength={120} placeholder="The room or building" value={where.venue} onChange={set("venue")} />
            </Field>
            <details className="ev-address" open={Boolean(where.street_address || where.locality)}>
              <summary>Street address (helps maps and calendars)</summary>
              <Field label="Street" htmlFor="ev-street">
                <TextInput id="ev-street" maxLength={120} autoComplete="street-address" value={where.street_address} onChange={set("street_address")} />
              </Field>
              <div className="ev-row">
                <Field label="Town or city" htmlFor="ev-locality">
                  <TextInput id="ev-locality" maxLength={120} autoComplete="address-level2" value={where.locality} onChange={set("locality")} />
                </Field>
                <Field label="Region" htmlFor="ev-region">
                  <TextInput id="ev-region" maxLength={120} autoComplete="address-level1" value={where.region} onChange={set("region")} />
                </Field>
              </div>
              <div className="ev-row">
                <Field label="Postal code" htmlFor="ev-postal">
                  <TextInput id="ev-postal" maxLength={120} autoComplete="postal-code" value={where.postal_code} onChange={set("postal_code")} />
                </Field>
                <Field label="Country" htmlFor="ev-country">
                  <TextInput id="ev-country" maxLength={120} autoComplete="country-name" value={where.country} onChange={set("country")} />
                </Field>
              </div>
            </details>
          </>
        ) : (
          <Field label="Link" required htmlFor="ev-link">
            <TextInput id="ev-link" type="url" required placeholder="https://" value={where.online_url} onChange={set("online_url")} />
          </Field>
        )}
      </fieldset>
    </>
  );
}

interface SubmitResult {
  process_id?: string;
  auto_approved?: boolean;
  flagged?: boolean;
  edited?: boolean;
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
  time_zone: string | null;
  image_url: string | null;
  image_alt: string | null;
  capacity: number | null;
}

/**
 * The form, inside the hub's drafting shell (its slim phone header and its
 * Code of Conduct line). New: draft, fill, submit for review. "Edit & resubmit"
 * after an admin asked for changes: ?draft=&review=. "Edit event" on a live
 * one (A1): ?draft=&edit=<process id>, which the hub applies in place.
 */
function EventFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reviewId = params.get("review");
  const editId = params.get("edit");
  const pageTitle = editId ? "Edit event" : "New event";
  const back = editId ? `/events/${editId}` : "/events";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [where, setWhere] = useState<WhereFields>(EMPTY_WHERE);
  const hubZone = useHubZone();
  const [zone, setZone] = useState<string | null>(null);
  const [image, setImage] = useState<EventImage | null>(null);
  const [capacity, setCapacity] = useState("");
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
        setStart(d.start_time);
        setEnd(d.end_time);
        setZone(d.time_zone);
        setImage(d.image_url ? { url: d.image_url, alt: d.image_alt ?? "" } : null);
        setCapacity(d.capacity ? String(d.capacity) : "");
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
        body: {
          title,
          description,
          start_time: start,
          end_time: end,
          ...whereBody(where),
          time_zone: zone ?? hubZone,
          image_url: image?.url ?? null,
          image_alt: image?.alt || null,
          capacity: capacity.trim() ? Number(capacity) : null,
        },
      });
      const result = await api<SubmitResult>(`/calendar/drafts/${id}/submit`, {
        method: "POST",
        body: editId ? { edit_process_id: editId } : reviewId ? { review_id: reviewId } : {},
      });
      if (editId) navigate(`/events/${editId}`);
      else if (result.auto_approved && result.process_id) navigate(`/events/${result.process_id}`);
      else setQueued(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = (body: ReactNode) => (
    <DraftShell backTo={back} backLabel={editId ? "Back to the event" : "Events"} title={pageTitle} phoneTitle={pageTitle} assistant={null} layout="page" error={error}>
      {body}
    </DraftShell>
  );

  if (!signedIn()) return shell(<p>Sign in to add an event to the calendar.</p>);
  if (queued) {
    return shell(
      <>
        <p role="status">Thank you. Your event is with the hub's admins, and goes on the calendar once they approve it.</p>
        <Link to="/events">Back to the calendar</Link>
      </>,
    );
  }
  return shell(
    <form className="ev-form" onSubmit={submit}>
      <Field label="Name" required htmlFor="ev-title">
        <TextInput id="ev-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="What it is" htmlFor="ev-description">
        <TextArea id="ev-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <When
        start={start}
        end={end}
        zone={zone ?? hubZone}
        onTimes={(s, e) => {
          setStart(s);
          setEnd(e);
        }}
        onZone={setZone}
      />
      <WhenWhere where={where} onWhere={setWhere} />
      <Field label="Limit" optional htmlFor="ev-capacity" hint="The most people who can say they're going. Leave it empty for no limit.">
        <TextInput
          id="ev-capacity"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={String(CAPACITY_MAX).length}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </Field>
      <Picture image={image} onImage={setImage} />
      <div className="ev-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? (editId ? "Saving…" : "Submitting…") : editId ? "Save" : "Submit"}
        </Button>
      </div>
    </form>,
  );
}

/** The feed's card when an event goes on the calendar: when and where, from its own payload. */
function eventCard({ data, id, getTitle }: { data: Record<string, unknown>; id: string; getTitle: (id: string) => string | undefined }) {
  const p = (data.process ?? {}) as { title?: string; event?: { start_time?: string; end_time?: string; location?: EventLocation; time_zone?: string } };
  const ev = p.event;
  const when = ev?.start_time && ev.end_time ? whenLine(ev.start_time, ev.end_time, ev.time_zone) : "";
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
    { path: "/events/new", element: <EventFormPage /> },
    { path: "/events/:id", element: <EventPage /> },
  ],
  feed: {
    event: {
      card: eventCard,
      // Its picture on the card (Events 2, 1), from the event as it now is.
      async meta(id) {
        const e = await api<EventView>(`/process/${encodeURIComponent(id)}/state`);
        return e.image ? { imageUrl: e.image.url, imageAlt: e.image.alt } : {};
      },
    },
  },
};

export default eventsUi;
