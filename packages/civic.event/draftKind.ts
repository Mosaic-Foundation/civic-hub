// What an event draft stores and what submitting it creates. The routes, the
// claim against a double submit, the Code of Conduct check and the review
// queue are the hub's; an admin's submission is approved at once.

import { ValidationError, type Draft, type DraftKind } from "@civic-social/plugin-sdk";
import { TYPE } from "./manifest.js";
import {
  ADDRESS_FIELD_MAX,
  EventInputError,
  TITLE_MAX,
  VENUE_MAX,
  checkTimes,
  instant,
  locationFrom,
  onlineLink,
} from "./event.js";

export type EventDraft = Draft<{
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  street_address: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  online_url: string | null;
}>;

/** An EventInputError as the drafts route's 400. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof EventInputError) throw new ValidationError(err.message, err.code);
    throw err;
  }
}

const nullable = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);

function textField(max: number, label: string) {
  return {
    read: (v: unknown) => nullable(v),
    write: (v: unknown) => {
      if (v !== null && typeof v !== "string") throw new ValidationError(`${label} must be text.`);
      const s = (v ?? "").trim();
      if (s.length > max) throw new ValidationError(`${label} can be at most ${max} characters.`, "too_long");
      return s || null;
    },
    checked: true,
  };
}

function timeField(label: string) {
  return {
    read: (v: unknown) => (typeof v === "string" ? new Date(v).toISOString() : null),
    write: (v: unknown) => checked(() => instant(v, label)),
  };
}

export const eventDraftKind: DraftKind<EventDraft> = {
  tag: "event",
  spec: {
    processType: TYPE,
    table: "calendar_drafts",
    idPrefix: "edraft",
    fields: {
      start_time: timeField("The start"),
      end_time: timeField("The end"),
      venue: textField(VENUE_MAX, "The place"),
      street_address: textField(ADDRESS_FIELD_MAX, "The street address"),
      locality: textField(ADDRESS_FIELD_MAX, "The town or city"),
      region: textField(ADDRESS_FIELD_MAX, "The region"),
      postal_code: textField(ADDRESS_FIELD_MAX, "The postal code"),
      country: textField(ADDRESS_FIELD_MAX, "The country"),
      online_url: {
        read: (v: unknown) => nullable(v),
        write: (v: unknown) => checked(() => onlineLink(v)),
        checked: true,
      },
    },
  },
  missing: (d) => {
    if (!d.title.trim()) return "Give the event a name.";
    if (d.title.trim().length > TITLE_MAX) return `The name can be at most ${TITLE_MAX} characters.`;
    if (!d.start_time) return "Say when the event starts.";
    if (!d.end_time) return "Say when the event ends.";
    if (!d.venue && !d.online_url) return "Say where the event is: a place, or an online link.";
    return null;
  },
  build(d) {
    return checked(() => {
      const times = checkTimes(d.start_time, d.end_time);
      const location = locationFrom(d);
      const state = { ...times, location };
      return { title: d.title.trim(), description: d.description.trim(), state, revise: { state } };
    });
  },
};
