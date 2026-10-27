// Events' own routes, under /calendar: the calendar as JSON for its page, and
// as iCalendar at a stable address any calendar app can subscribe to. Both
// public: a published event is the public record.

import { Router, type Request } from "express";
import { route } from "@civic-social/plugin-sdk";
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
    });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="hub.ics"');
    res.set("Cache-Control", "public, max-age=300");
    res.send(body);
  }),
);

export default router;
