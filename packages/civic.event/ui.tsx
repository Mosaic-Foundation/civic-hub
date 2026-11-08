// Events' UI module: the calendar, an event's page, and the form to propose
// and edit one. Composed of the hub's UI kit alone (@civic-social/plugin-sdk/ui;
// Events 3: its page head, day groups, list cards, view toggle, month grid and
// week strip, facts, notices, fields and drafting shell), so it looks exactly
// like the hub's own pages in any theme and layout; styles.css sets layout
// only (conformance step 22). Every time is shown in the hub's zone
// (hubTimeZone()), named once on a page. It reads and acts through the hub's
// routes for every process (/process/:id/state, /process/:id/action,
// /process/:id/edit), the hub's drafts routes at /calendar/drafts, and its own
// /calendar routes.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  CardList,
  Chip,
  ChipGroup,
  DateTimeInput,
  DayGroup,
  DraftShell,
  EmptyState,
  FactList,
  Field,
  Fieldset,
  Group,
  ImageUpload,
  ListCard,
  MonthGrid,
  Note,
  Notice,
  Page,
  PageAction,
  PageHead,
  Picture as KitPicture,
  RadioCards,
  Select,
  StatusChip,
  TextArea,
  TextInput,
  ViewToggle,
  WeekStrip,
  dayKey,
  groupByDay,
  hubTimeZone,
  type CalendarItem,
  type ProcessUi,
} from "@civic-social/plugin-sdk/ui";
import {
  ALT_MAX,
  CAPACITY_MAX,
  MESSAGE_MAX,
  SUBJECT_MAX,
  defaultEnd,
  durationMinutes,
  endAfter,
  locationLine,
  quarterHours,
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

// --- Dates: every time in the hub's zone (Events 3) ------------------------------

/** "7:00 PM", with the zone's short name ("CST") when `named`. */
const timeOf = (iso: string, timeZone: string, named = false) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit", ...(named ? { timeZoneName: "short" as const } : {}) });

/** "Sat, Nov 15": a day in a line of facts. */
const shortDay = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" });

/** "Saturday, November 15, 2030": a day said in full. */
const longDay = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** The zone in words, once on a page: "Central Time"; "UTC" for UTC. */
function zoneWords(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? timeZone.replace(/_/g, " ");
}

/** "7:00 PM – 9:00 PM", or across days "7:00 PM – Sun, Nov 16, 9:00 AM". */
function timeRange(start: string, end: string, zone: string, named = false): string {
  return dayKey(start, zone) === dayKey(end, zone)
    ? `${timeOf(start, zone)} – ${timeOf(end, zone, named)}`
    : `${timeOf(start, zone)} – ${shortDay(end, zone)}, ${timeOf(end, zone, named)}`;
}

/** "Saturday, November 15, 2030, 7:00 PM – 9:00 PM CST": the zone named once, at the end. */
function whenLine(start: string, end: string, zone: string, named = true): string {
  return dayKey(start, zone) === dayKey(end, zone)
    ? `${longDay(start, zone)}, ${timeRange(start, end, zone, named)}`
    : `${longDay(start, zone)}, ${timeOf(start, zone)} – ${longDay(end, zone)}, ${timeOf(end, zone, named)}`;
}

/** Whether two zones show the same hour at this instant. */
const sameClock = (iso: string, a: string, b: string) => timeOf(iso, a, true) === timeOf(iso, b, true);

// --- Pieces -------------------------------------------------------------------

/** Where, in a line: "Online" or the place and its address. */
const whereWords = (location: EventLocation) => (location.type === "Link" ? "Online" : locationLine(location));

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

type View = "list" | "calendar";
const VIEW_KEY = "civic.event.view";

/** The reader's chosen view, kept in their browser (Events 3). */
function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  });
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // A browser that keeps nothing still switches; it just forgets.
    }
  };
  return [view, choose];
}

/** Whether the page is wider than a phone: the month on a desktop, the week on a phone. */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function CalendarPage() {
  const zone = hubTimeZone();
  const wide = useWide();
  const [view, setView] = useView();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = dayKey(new Date(), zone);
  const [day, setDay] = useState(today);
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
  const byDay = useMemo(() => groupByDay(upcoming, (e) => e.start_time, zone), [upcoming, zone]);
  const items: CalendarItem[] = useMemo(
    () =>
      (events ?? []).map((e) => ({
        id: e.process_id,
        day: dayKey(e.start_time, zone),
        label: `${timeOf(e.start_time, zone)} ${e.title}`,
        kind: "event",
        cancelled: e.cancelled,
      })),
    [events, zone],
  );
  const onDay = (events ?? []).filter((e) => dayKey(e.start_time, zone) === day);

  return (
    <Page>
      <PageHead
        title="Events"
        lede={<>What's on, by day. Times are {zoneWords(zone)}.</>}
        action={
          signedIn() ? (
            <PageAction href="/events/new" as={Link}>
              Add an event
            </PageAction>
          ) : undefined
        }
      >
        <Note>
          <a href="/api/calendar/hub.ics">Subscribe in your calendar app</a>
        </Note>
      </PageHead>
      <ViewToggle
        value={view}
        onChange={setView}
        label="Show the events as"
        options={[
          { value: "list", label: "List" },
          { value: "calendar", label: "Calendar" },
        ]}
      />
      {(error || !events) && (
        <Group>
          {error ? (
            <Notice tone="alert" role="alert">
              {error}
            </Notice>
          ) : (
            <Note>Loading…</Note>
          )}
        </Group>
      )}

      {events && view === "list" && (
        <>
          {upcoming.length === 0 && (
            <Group>
              <EmptyState>
                Nothing is on the calendar yet.{signedIn() ? " Add an event and it shows here, under its day." : ""}
              </EmptyState>
            </Group>
          )}
          {byDay.map((g) => (
            <DayGroup key={g.day} date={g.items[0]!.start_time} timeZone={zone}>
              <CardList>
                {g.items.map((e) => (
                  <li key={e.process_id}>
                    <EventCard event={e} when={timeRange(e.start_time, e.end_time, zone)} />
                  </li>
                ))}
              </CardList>
            </DayGroup>
          ))}
          {past.length > 0 && (
            <Group heading={`Past events (${past.length})`} label="Past events" collapsible className="ev-past">
              <CardList>
                {past.map((e) => (
                  <li key={e.process_id}>
                    <EventCard event={e} when={`${shortDay(e.start_time, zone)}, ${timeOf(e.start_time, zone)}`} />
                  </li>
                ))}
              </CardList>
            </Group>
          )}
        </>
      )}

      {events && view === "calendar" && (
        <div data-testid="events-calendar">
          <Group>
            {wide ? (
              <MonthGrid items={items} selected={day} onSelect={setDay} today={today} label="Events by month" />
            ) : (
              <WeekStrip items={items} selected={day} onSelect={setDay} today={today} label="Events by week" />
            )}
          </Group>
          <DayGroup date={`${day}T12:00:00Z`} timeZone="UTC">
            {onDay.length === 0 ? (
              <EmptyState>Nothing on this day.</EmptyState>
            ) : (
              <CardList>
                {onDay.map((e) => (
                  <li key={e.process_id}>
                    <EventCard event={e} when={timeRange(e.start_time, e.end_time, zone)} />
                  </li>
                ))}
              </CardList>
            )}
          </DayGroup>
        </div>
      )}
    </Page>
  );
}

/** An event on the calendar: the Events bar and chip, its time strong, its place quiet, Cancelled as a status. */
function EventCard({ event, when }: { event: CalendarEvent; when: string }) {
  return (
    <ListCard
      className="ev-item"
      href={`/events/${event.process_id}`}
      linkAs={Link}
      kind="event"
      kindLabel="Event"
      title={event.title}
      status={event.cancelled ? <StatusChip tone="alert">Cancelled</StatusChip> : undefined}
      meta={[<strong key="when">{when}</strong>, whereWords(event.location)]}
    />
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

  if (!event) {
    return (
      <Page>
        <Group>
          {message ? (
            <Notice tone="alert" role="alert">
              {message}
            </Notice>
          ) : (
            <Note>Loading…</Note>
          )}
        </Group>
      </Page>
    );
  }
  const upcoming = event.status === "active";
  const organiser = event.is_creator || isAdmin;
  const canCancel = upcoming && organiser;
  const count = going?.count ?? event.going_count;
  // Every time on the page in the hub's zone, named once (Events 3); the
  // reader's own beside it when their clock differs.
  const zone = hubTimeZone();
  const mine = readerZone();
  const log = event.announcements ?? adminLog;
  const ended = event.type_status && event.type_status.id !== "scheduled" && !event.cancelled ? event.type_status.label : null;

  return (
    <Page>
      <Group label="Back to Events">
        <Note>
          <Link to="/events">‹ Events</Link>
        </Note>
        {event.image && <KitPicture src={event.image.url} alt={event.image.alt} data-testid="event-image" />}
      </Group>
      <PageHead
        title={event.title}
        lede={
          <span className="ev-chips">
            <Chip kind="event">Event</Chip>
            {event.cancelled && <StatusChip tone="alert">Cancelled</StatusChip>}
            {ended && <StatusChip tone="done">{ended}</StatusChip>}
          </span>
        }
      />
      <Group label="The event">
        {event.cancelled && (
          <Notice tone="alert">
            This event was cancelled.{event.cancelled.reason ? ` ${event.cancelled.reason}` : ""}
          </Notice>
        )}
        {!event.cancelled && !upcoming && <Notice>This event has ended.</Notice>}
        <FactList
          className="ev-facts"
          items={[
            {
              term: "When",
              value: whenLine(event.start_time, event.end_time, zone),
              testId: "event-when",
              more: [
                !sameClock(event.start_time, zone, mine) && (
                  <span data-testid="event-when-mine">Your time: {whenLine(event.start_time, event.end_time, mine)}</span>
                ),
              ],
            },
            { term: "Where", value: <Where location={event.location} /> },
            {
              term: "Going",
              value: goingLine(count, event.capacity, event.spots_left),
              testId: "going-count",
              more: [going?.names && going.names.length > 0 && <span data-testid="going-names">{going.names.join(", ")}</span>],
            },
          ]}
        />
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
        {upcoming && !signedIn() && <Note>Sign in to say you're going.</Note>}

        <Note>
          <a href={`/api/calendar/events/${encodeURIComponent(event.id)}.ics`} download data-testid="add-to-calendar">
            Add to my calendar
          </a>
        </Note>

        {(editable || canCancel) && (
          <div className="ev-actions">
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
          <Card className="ev-panel">
            <form
              className="ev-form"
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
          </Card>
        )}
        {message && <Note role="status">{message}</Note>}

        {upcoming && organiser && <AnnouncePanel count={event.is_going ? count - 1 : count} busy={busy} onSend={(payload) => act("announce", payload)} />}
      </Group>
      {log && log.length > 0 && <AnnouncementLog log={log} organiser={event.is_creator} />}
    </Page>
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
      <div className="ev-rsvp" data-testid="rsvp">
        <ChipGroup
          label="Are you going?"
          value="going"
          onChange={(v) => v === "not_going" && onNotGoing()}
          options={[
            {
              value: "going",
              label: (
                <>
                  <span aria-hidden="true">✓ </span>You're going
                </>
              ),
              disabled: busy,
            },
            { value: "not_going", label: "Not going", disabled: busy },
          ]}
        />
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
      <div className="ev-actions">
        <Button onClick={() => setOpen(true)} disabled={count < 1} title={count < 1 ? "Nobody else is going yet." : undefined}>
          Message the people going
        </Button>
      </div>
    );
  }
  return (
    <Card className="ev-panel">
      <form
        className="ev-form"
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
        <Note>
          To the {count === 1 ? "person" : `${count} people`} going, by email from the hub. Their addresses stay with the hub.
        </Note>
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
    </Card>
  );
}

/** What the people going were sent: its own messages, and what changed. */
function AnnouncementLog({ log, organiser }: { log: Announcement[]; organiser: boolean }) {
  return (
    <div data-testid="announcements">
      <Group heading="From the organiser">
        <CardList>
          {log.map((a) => (
            <li key={a.id}>
              <Card>
                <p className="ev-announcement-subject">
                  {a.kind === "change" && <Chip>Change</Chip>} <strong>{a.subject}</strong>
                </p>
                <p className="ev-announcement-body">{a.body}</p>
                <Note>
                  {new Date(a.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: hubTimeZone() })}
                  {organiser && a.recipients !== undefined && ` · to ${a.recipients}, emailed ${a.sent}${a.held_back ? `, ${a.held_back} held back by the hub's mode` : ""}`}
                </Note>
              </Card>
            </li>
          ))}
        </CardList>
      </Group>
    </div>
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
 * When it is (Events 2, 2 and 3; Events 3): the start, how long it runs and
 * the end, in that order, kept together, all in the event's zone. How long is
 * two selects, hours (0 to 8) and minutes (0, 15, 30, 45), rounded to the
 * quarter hour as the date picker steps. Choosing a start keeps how long it
 * runs (an hour to begin with, the same day); a duration moves the end; an end
 * moves the duration. An end at or before the start says so on the field.
 */
function When({
  start,
  end,
  zone,
  hubZone,
  onTimes,
  onZone,
}: {
  start: string | null;
  end: string | null;
  zone: string;
  hubZone: string;
  onTimes(start: string | null, end: string | null): void;
  onZone(zone: string): void;
}) {
  const minutes = durationMinutes(start, end);
  // How long, before there is a start to measure from: an hour.
  const [planned, setPlanned] = useState(60);
  const shown = quarterHours(minutes) ?? (start && end ? { hours: 0, minutes: 0 as const } : quarterHours(planned)!);
  const endError = start && end && !minutes ? "Ends must be after it starts." : null;

  function startChanged(next: string | null) {
    if (!next) return onTimes(null, end);
    const keep = durationMinutes(start, end);
    if (keep) return onTimes(next, endAfter(next, keep));
    onTimes(next, planned === 60 ? defaultEnd(next, zone) : endAfter(next, planned));
  }

  function durationChanged(hours: number, mins: number) {
    const total = hours * 60 + mins;
    if (total > 0) setPlanned(total);
    if (start) onTimes(start, endAfter(start, total));
  }

  const hourChoices = Array.from({ length: 9 }, (_, h) => h);
  if (shown.hours > 8) hourChoices.push(shown.hours);

  return (
    <>
      <div className="ev-row ev-row--three">
        <Field label="Starts" required htmlFor="ev-start">
          <DateTimeInput id="ev-start" required value={start} timeZone={zone} onChange={startChanged} />
        </Field>
        <Field label="Duration" htmlFor="ev-duration-hours">
          <div className="ev-duration" role="group" aria-label="Duration" id="ev-duration">
            <Select
              id="ev-duration-hours"
              aria-label="Hours"
              value={String(shown.hours)}
              onChange={(e) => durationChanged(Number(e.target.value), shown.minutes)}
            >
              {hourChoices.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </Select>
            <Select
              id="ev-duration-minutes"
              aria-label="Minutes"
              value={String(shown.minutes)}
              onChange={(e) => durationChanged(shown.hours, Number(e.target.value))}
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Ends" required htmlFor="ev-end" hint={endError ?? undefined}>
          <DateTimeInput
            id="ev-end"
            required
            value={end}
            timeZone={zone}
            aria-invalid={endError ? true : undefined}
            onChange={(v) => onTimes(start, v)}
          />
        </Field>
      </div>
      <Field
        label="Time zone"
        htmlFor="ev-zone"
        hint={zone === hubZone ? `The hub's own (${zoneWords(zone)}). Choose another only for an event somewhere else.` : "The times above are in this zone. The calendar shows them in the hub's."}
      >
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
 * Its picture (Events 2, 1): the kit's picture upload, sent through the
 * hub's route for this type, made smaller in the browser first when it is
 * large (as the hub's composers do), with what it shows for people who can't
 * see it.
 */
function Picture({ image, onImage }: { image: EventImage | null; onImage(i: EventImage | null): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chosen(file: File | null) {
    if (!file) return onImage(null);
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
    <Fieldset
      legend={
        <>
          Picture <span className="optional">(optional)</span>
        </>
      }
    >
      <ImageUpload value={image?.url ?? null} onChange={(f) => void chosen(f)} accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} />
      {image && (
        <Field label="What the picture shows" hint="For people who can't see it." htmlFor="ev-alt">
          <TextInput id="ev-alt" maxLength={ALT_MAX} value={image.alt} onChange={(e) => onImage({ ...image, alt: e.target.value })} />
        </Field>
      )}
      {busy && <Note>Uploading…</Note>}
      {error && (
        <Notice tone="alert" role="alert">
          {error}
        </Notice>
      )}
    </Fieldset>
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
  const [address, setAddress] = useState(false);
  const showAddress = address || Boolean(where.street_address || where.locality || where.region || where.postal_code || where.country);
  return (
    <Fieldset legend="Where">
      <RadioCards
        name="where"
        label="Where"
        value={where.mode}
        onChange={(mode) => onWhere({ ...where, mode })}
        options={[
          { value: "place", title: "A place" },
          { value: "online", title: "Online" },
        ]}
      />
      {where.mode === "place" ? (
        <>
          <Field label="Place" required htmlFor="ev-venue">
            <TextInput id="ev-venue" required maxLength={120} placeholder="The room or building" value={where.venue} onChange={set("venue")} />
          </Field>
          {showAddress ? (
            <>
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
            </>
          ) : (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setAddress(true)}>
                Add a street address (helps maps and calendars)
              </Button>
            </div>
          )}
        </>
      ) : (
        <Field label="Link" required htmlFor="ev-link">
          <TextInput id="ev-link" type="url" required placeholder="https://" value={where.online_url} onChange={set("online_url")} />
        </Field>
      )}
    </Fieldset>
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
  const hubZone = hubTimeZone();
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

  if (!signedIn()) return shell(<Note>Sign in to add an event to the calendar.</Note>);
  if (queued) {
    return shell(
      <>
        <Notice>Thank you. Your event is with the hub's admins, and goes on the calendar once they approve it.</Notice>
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
        hubZone={hubZone}
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

/**
 * The feed's card when an event goes on the calendar: when and where, from
 * its own payload, the time in the hub's zone (Events 3). The feed names no
 * zone of its own, so the card names it only for a reader whose clock is not
 * the hub's.
 */
function eventCard({ data, id, getTitle }: { data: Record<string, unknown>; id: string; getTitle: (id: string) => string | undefined }) {
  const p = (data.process ?? {}) as { title?: string; event?: { start_time?: string; end_time?: string; location?: EventLocation } };
  const ev = p.event;
  const zone = hubTimeZone();
  const when = ev?.start_time && ev.end_time ? whenLine(ev.start_time, ev.end_time, zone, !sameClock(ev.start_time, zone, readerZone())) : "";
  const where = ev?.location ? whereWords(ev.location) : "";
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
