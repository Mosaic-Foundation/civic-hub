// The right column's data (ADR-019): GET /api/aside once, and the calendar
// (GET /calendar/events) while the Events plugin is on. Read once when the
// column first draws; the column stays mounted as the reader moves between
// pages, so a page change costs nothing. A failed read draws nothing, never an
// error: the column is an aside.

import { useEffect, useState } from "react";
import { getAside, getCalendarEvents, type AsideFacts, type CalendarEventRow } from "../services/api";
import { pluginEnabled, type PluginId } from "../config/plugins";

/** The plugin whose calendar Coming up reads its events from. */
export const CALENDAR_PLUGIN: PluginId = "events";

export interface AsideData {
  facts: AsideFacts | null;
  /** The calendar, or null when the plugin is off or it did not load. */
  events: CalendarEventRow[] | null;
  loaded: boolean;
}

export function useAsideData(): AsideData {
  const calendarOn = pluginEnabled(CALENDAR_PLUGIN);
  const [data, setData] = useState<AsideData>({ facts: null, events: null, loaded: false });
  useEffect(() => {
    let live = true;
    void Promise.all([
      getAside().catch(() => null),
      calendarOn ? getCalendarEvents().catch(() => null) : Promise.resolve(null),
    ]).then(([facts, events]) => {
      if (live) setData({ facts, events, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [calendarOn]);
  return data;
}
