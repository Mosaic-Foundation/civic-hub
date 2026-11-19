// The right column's data (ADR-019): the calendar (GET /calendar/events)
// while the Events plugin is on. Each feature's card reads its own (the
// Pinned card, the About card's Members line). Read once when the
// column first draws; the column stays mounted as the reader moves between
// pages, so a page change costs nothing. A failed read draws nothing, never an
// error: the column is an aside.

import { useEffect, useState } from "react";
import { getCalendarEvents, type CalendarEventRow } from "../services/api";
import { pluginEnabled, type PluginId } from "../config/plugins";

/** The plugin whose calendar Coming up reads its events from. */
export const CALENDAR_PLUGIN: PluginId = "events";

export interface AsideData {
  /** The calendar, or null when the plugin is off or it did not load. */
  events: CalendarEventRow[] | null;
  loaded: boolean;
}

export function useAsideData(): AsideData {
  const calendarOn = pluginEnabled(CALENDAR_PLUGIN);
  const [data, setData] = useState<AsideData>({ events: null, loaded: false });
  useEffect(() => {
    let live = true;
    void (calendarOn ? getCalendarEvents().catch(() => null) : Promise.resolve(null)).then((events) => {
      if (live) setData({ events, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [calendarOn]);
  return data;
}
