// What an event draft stores and what submitting it creates. The routes, the
// claim against a double submit, the Code of Conduct check and the review
// queue are the hub's; an admin's submission is approved at once.

import { ValidationError, applyEdit, type Draft, type DraftKind } from "@civic-social/plugin-sdk";
import { TYPE } from "./manifest.js";
import {
  ADDRESS_FIELD_MAX,
  ALT_MAX,
  EventInputError,
  TITLE_MAX,
  VENUE_MAX,
  capacityOf,
  checkTimes,
  imageOf,
  instant,
  locationFrom,
  onlineLink,
  timeZoneOf,
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
  /** 0.3.0 */
  time_zone: string | null;
  image_url: string | null;
  image_alt: string | null;
  capacity: number | null;
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

/** A free-text field others will read: the Code of Conduct check reads it under its label (engine 2, A1). */
function textField(max: number, label: string) {
  return {
    coc: label,
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
        coc: "The online link",
      },
      // 0.3.0: its zone, its picture (from the hub's upload route) and its limit.
      time_zone: {
        read: (v: unknown) => nullable(v),
        write: (v: unknown) => checked(() => timeZoneOf(v)),
      },
      image_url: {
        read: (v: unknown) => nullable(v),
        write: (v: unknown) => checked(() => imageOf(v, "")?.url ?? null),
      },
      image_alt: textField(ALT_MAX, "The picture's description"),
      capacity: {
        read: (v: unknown) => (typeof v === "number" ? v : null),
        write: (v: unknown) => checked(() => capacityOf(v)),
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
      const image = imageOf(d.image_url, d.image_alt);
      const state = {
        ...times,
        location,
        // The handler fills in the hub's zone when the draft has none.
        ...(d.time_zone ? { time_zone: timeZoneOf(d.time_zone) } : {}),
        ...(image ? { image } : {}),
        ...(d.capacity ? { capacity: capacityOf(d.capacity) } : {}),
      };
      return { title: d.title.trim(), description: d.description.trim(), state, revise: { state } };
    });
  },
  // "Edit event" (A1): the creator or an admin, from the event's page. The
  // hub has run the check on this draft; its edit path writes the words and
  // the time and place together, at the event's version.
  async applyLiveEdit(_d, processId, editor, submission) {
    const state = (submission.state ?? {}) as Record<string, unknown>;
    const changes = await applyEdit(processId, editor, {
      title: submission.title,
      description: submission.description,
      // An edit may clear the picture or the limit: null, not left out.
      state: {
        start_time: state.start_time,
        end_time: state.end_time,
        location: state.location,
        time_zone: state.time_zone ?? null,
        image: state.image ?? null,
        capacity: state.capacity ?? null,
      },
    });
    return { process_id: processId, edited: true, changed_fields: changes.changed_fields };
  },
};
