// Events' own routes, under /calendar: the calendar as JSON for its page, and
// as iCalendar at a stable address any calendar app can subscribe to. Both
// public: a published event is the public record.

import { Router, type Request } from "express";
import { namesFor, route } from "@civic-social/plugin-sdk";
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
    });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="hub.ics"');
    res.set("Cache-Control", "public, max-age=300");
    res.send(body);
  }),
);

export default router;
