/**
 * Events 0.4.2's "Add to my calendar" and "Subscribe" links
 * (packages/civic.event/calendarLinks.ts): each common calendar's own address,
 * carrying only the event's public details, then the .ics for any other app.
 */
import { describe, it, expect } from "vitest";
import { addToCalendarLinks, subscribeLinks } from "../../packages/civic.event/calendarLinks.js";

const ORIGIN = "https://hub.example";
const EVENT = {
  id: "proc_1",
  title: "Neighbours' evening & a dish",
  description: "Bring a plate.\n",
  start_time: "2030-06-01T17:00:00.000Z",
  end_time: "2030-06-01T19:30:00.000Z",
  place: "Community room, 1 Example Street",
  time_zone: "America/New_York",
};

const byLabel = (links: ReturnType<typeof subscribeLinks>, label: string) => links.find((l) => l.label === label)!;

describe("addToCalendarLinks", () => {
  const links = addToCalendarLinks(EVENT, ORIGIN);

  it("names the common calendars first, then any other app", () => {
    expect(links.map((l) => l.label)).toEqual([
      "Google Calendar",
      "Apple Calendar",
      "Outlook.com",
      "Outlook (work or school)",
      "Another app (.ics file)",
    ]);
  });

  it("gives Google the event in UTC, shown in the event's zone, linked back to its page", () => {
    const url = new URL(byLabel(links, "Google Calendar").href);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(EVENT.title);
    expect(url.searchParams.get("dates")).toBe("20300601T170000Z/20300601T193000Z");
    expect(url.searchParams.get("ctz")).toBe("America/New_York");
    expect(url.searchParams.get("location")).toBe(EVENT.place);
    expect(url.searchParams.get("details")).toBe("Bring a plate.\n\nhttps://hub.example/events/proc_1");
  });

  it("leaves the zone out when the event has none", () => {
    const url = new URL(addToCalendarLinks({ ...EVENT, time_zone: null }, ORIGIN)[0]!.href);
    expect(url.searchParams.has("ctz")).toBe(false);
  });

  it("gives both Outlooks the same compose form", () => {
    for (const [label, host] of [
      ["Outlook.com", "outlook.live.com"],
      ["Outlook (work or school)", "outlook.office.com"],
    ] as const) {
      const url = new URL(byLabel(links, label).href);
      expect(url.host).toBe(host);
      expect(url.pathname).toBe("/calendar/0/deeplink/compose");
      expect(url.searchParams.get("rru")).toBe("addevent");
      expect(url.searchParams.get("subject")).toBe(EVENT.title);
      expect(url.searchParams.get("startdt")).toBe("2030-06-01T17:00:00Z");
      expect(url.searchParams.get("enddt")).toBe("2030-06-01T19:30:00Z");
    }
  });

  it("saves the event's .ics for Apple and any other app", () => {
    for (const label of ["Apple Calendar", "Another app (.ics file)"]) {
      expect(byLabel(links, label)).toEqual({ label, href: "https://hub.example/api/calendar/events/proc_1.ics", download: true });
    }
  });
});

describe("subscribeLinks", () => {
  const links = subscribeLinks(ORIGIN);
  const feed = "https://hub.example/api/calendar/hub.ics";

  it("subscribes Google and Apple by webcal, the Outlooks by the feed's address", () => {
    expect(byLabel(links, "Google Calendar").href).toBe(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent("webcal://hub.example/api/calendar/hub.ics")}`,
    );
    expect(byLabel(links, "Apple Calendar").href).toBe("webcal://hub.example/api/calendar/hub.ics");
    expect(new URL(byLabel(links, "Outlook.com").href).searchParams.get("url")).toBe(feed);
    expect(new URL(byLabel(links, "Outlook (work or school)").href).host).toBe("outlook.office.com");
    expect(byLabel(links, "Another app (copy this link)").href).toBe(feed);
  });

  it("keeps a local hub's http as webcal", () => {
    expect(subscribeLinks("http://athens.localhost:4173")[1]!.href).toBe("webcal://athens.localhost:4173/api/calendar/hub.ics");
  });
});
