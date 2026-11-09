// "Add to my calendar" and "Subscribe" for the common calendars (Events 0.4.2,
// Adam 2026-11-09). An .ics file opens in the device's default calendar app;
// someone who keeps their calendar in Google or Outlook would rather land in
// it, choose which of their calendars, and save. Each link is a plain address
// the reader's own browser opens: the hub calls nobody, and the links carry
// only the event's public details (its title, time, place, words and page).
//
// Pure: the page passes its own origin and the event's place in words.

export interface CalendarLink {
  /** Which calendar, in words ("Google Calendar"). */
  label: string;
  href: string;
  /** The .ics file itself, for the reader's own app: the browser saves it. */
  download?: boolean;
}

export interface LinkableEvent {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  /** Where, in words (an online event's link). */
  place: string;
  time_zone: string | null;
}

/** 2026-11-09T18:30:00.000Z → 20261109T183000Z (Google's form). */
function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** 2026-11-09T18:30:00.000Z → 2026-11-09T18:30:00Z (Outlook's form). */
function isoUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}/, "");
}

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

/** One event, into each common calendar, then the .ics file for any other app. */
export function addToCalendarLinks(event: LinkableEvent, origin: string): CalendarLink[] {
  const page = `${origin}/events/${encodeURIComponent(event.id)}`;
  const ics = `${origin}/api/calendar/events/${encodeURIComponent(event.id)}.ics`;
  const details = [event.description.trim(), page].filter(Boolean).join("\n\n");
  const place = event.place;
  const outlook = query({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: isoUtc(event.start_time),
    enddt: isoUtc(event.end_time),
    body: details,
    location: place,
  });
  return [
    {
      label: "Google Calendar",
      href: `https://calendar.google.com/calendar/render?${query({
        action: "TEMPLATE",
        text: event.title,
        dates: `${compactUtc(event.start_time)}/${compactUtc(event.end_time)}`,
        ctz: event.time_zone ?? "",
        details,
        location: place,
      })}`,
    },
    { label: "Apple Calendar", href: ics, download: true },
    { label: "Outlook.com", href: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook}` },
    { label: "Outlook (work or school)", href: `https://outlook.office.com/calendar/0/deeplink/compose?${outlook}` },
    { label: "Another app (.ics file)", href: ics, download: true },
  ];
}

/** The hub's whole calendar, subscribed to in each, then its address for any other app. */
export function subscribeLinks(origin: string): CalendarLink[] {
  const feed = `${origin}/api/calendar/hub.ics`;
  const webcal = feed.replace(/^https?:/, "webcal:");
  return [
    { label: "Google Calendar", href: `https://calendar.google.com/calendar/render?${query({ cid: webcal })}` },
    { label: "Apple Calendar", href: webcal },
    { label: "Outlook.com", href: `https://outlook.live.com/calendar/0/addfromweb?${query({ url: feed })}` },
    { label: "Outlook (work or school)", href: `https://outlook.office.com/calendar/0/addfromweb?${query({ url: feed })}` },
    { label: "Another app (copy this link)", href: feed },
  ];
}
