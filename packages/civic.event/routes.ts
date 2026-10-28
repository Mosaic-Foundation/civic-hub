// Events' own routes, under /calendar: the calendar as JSON for its page, and
// as iCalendar at a stable address any calendar app can subscribe to. Both
// public: a published event is the public record.

import { Router, type Request } from "express";
import { NotFoundError, hubContext, namesFor, requireAdmin, route } from "@civic-social/plugin-sdk";
import { eventStore } from "./store.js";
import { toIcs } from "./ics.js";

/** The origin the reader reached the hub at, so links go back the same way. */
function originOf(req: Request): { origin: string; host: string } {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host") || "localhost";
  const proto = forwardedProto || req.protocol || "https";
  return { origin: `${proto}://${host}`, host: host.replace(/:\d+$/, "") };
}

const router = Router();

// GET /calendar/events: every event on the calendar, earliest first. The page
// splits upcoming from past; the count of who is going is on each event's page.
router.get(
  "/events",
  route(async (_req, res) => {
    const rows = await eventStore.get().calendar();
    res.json({
      events: rows.map(({ archived: _archived, ...row }) => row),
    });
  }),
);

// GET /calendar/events/:id/going: how many are going, and who, as the hub
// discloses it (engine 2, A3): names to signed-in members, none to the public
// (the type's `members` policy), never an account.
router.get(
  "/events/:id/going",
  route(async (req, res) => {
    const id = String(req.params.id);
    const accounts = await eventStore.get().goingAccounts(id);
    res.json({ count: accounts.length, names: await namesFor(req, id, accounts) });
  }),
);

// GET /calendar/hub.ics: the same calendar, cancelled events marked.
router.get(
  "/hub.ics",
  route(async (req, res) => {
    const { origin, host } = originOf(req);
    const rows = await eventStore.get().calendar();
    const body = toIcs(rows, {
      name: `Events · ${host}`,
      uidDomain: host,
      eventUrl: (id) => `${origin}/events/${id}`,
      now: new Date().toISOString(),
      defaultTimeZone: hubContext().timeZone,
    });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="hub.ics"');
    res.set("Cache-Control", "public, max-age=300");
    res.send(body);
  }),
);

// GET /calendar/events/:id.ics: one event, for "Add to my calendar" (Events 2,
// 6). The same UID as in hub.ics, so a calendar that has both keeps one; a
// link back to its page; its own zone named for the app to show it in.
router.get(
  "/events/:id.ics",
  route(async (req, res) => {
    const { origin, host } = originOf(req);
    const row = await eventStore.get().event(String(req.params.id));
    if (!row) throw new NotFoundError("That event is not on the calendar.");
    const zone = row.time_zone ?? hubContext().timeZone;
    const body = toIcs([row], {
      name: row.title,
      uidDomain: host,
      eventUrl: (id) => `${origin}/events/${id}`,
      now: new Date().toISOString(),
      timeZone: zone,
      defaultTimeZone: zone,
    });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${fileName(row.title)}.ics"`);
    res.set("Cache-Control", "public, max-age=60");
    res.send(body);
  }),
);

// GET /calendar/events/:id/announcements: what the people going were sent,
// for the hub's admins (Events 2, 5). The people going and its creator read
// them on its page (the read model); nobody else does, and never who.
router.get(
  "/events/:id/announcements",
  requireAdmin,
  route(async (req, res) => {
    const rows = await eventStore.get().announcements(String(req.params.id));
    res.json({ announcements: rows.map(({ sender: _sender, ...row }) => row) });
  }),
);

/** A file name from an event's title: letters, digits and dashes. */
function fileName(title: string): string {
  return title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60).toLowerCase() || "event";
}

export default router;
