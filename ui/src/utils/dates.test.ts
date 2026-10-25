import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  absoluteDate,
  absoluteDateOfDay,
  formatDate,
  formatShortDate,
  formatShortDateTime,
  localDateAtTime,
  localShortDate,
  localShortDateOfDay,
  localTimestamp,
} from "./dates";

// 3:30 in the afternoon, UTC. Every case runs in UTC unless it says otherwise.
const MOMENT = "2026-10-24T15:30:00Z";
const DAY = "2026-10-24";

// The test runs in node; the DOM types here don't know `process`.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const ORIGINAL_TZ = env.TZ;

/** ICU puts a narrow no-break space before AM/PM in newer versions; older ones a plain space. */
function plain(s: string): string {
  return s.replace(/\u202f/g, " ");
}

/**
 * Make the reader's locale `locale`: a call that names no locale gets it.
 * A call that names one ("en-US") is left alone, which is what tells the two
 * families of function apart.
 */
function readerSpeaks(locale: string): void {
  for (const method of ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"] as const) {
    const original = Date.prototype[method] as (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) => string;
    vi.spyOn(Date.prototype, method).mockImplementation(function (this: Date, l, o) {
      return original.call(this, l ?? locale, o);
    });
  }
}

beforeEach(() => {
  env.TZ = "UTC";
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_TZ === undefined) delete env.TZ;
  else env.TZ = ORIGINAL_TZ;
});

describe("the en-US functions (the same text for every reader)", () => {
  it("formatDate: the month in full", () => {
    expect(formatDate(MOMENT)).toBe("October 24, 2026");
  });

  it("formatShortDate: the month short", () => {
    expect(formatShortDate(MOMENT)).toBe("Oct 24, 2026");
  });

  it("formatShortDateTime: the month short, with the time", () => {
    expect(plain(formatShortDateTime(MOMENT))).toBe("Oct 24, 2026, 3:30 PM");
  });

  it("do not follow the reader's locale", () => {
    readerSpeaks("de-DE");
    expect(formatDate(MOMENT)).toBe("October 24, 2026");
    expect(formatShortDate(MOMENT)).toBe("Oct 24, 2026");
    expect(plain(formatShortDateTime(MOMENT))).toBe("Oct 24, 2026, 3:30 PM");
  });
});

describe("the reader's-locale functions", () => {
  beforeEach(() => readerSpeaks("en-US"));

  it("absoluteDate: the month in full", () => {
    expect(absoluteDate(MOMENT)).toBe("October 24, 2026");
  });

  it("localShortDate: the month short", () => {
    expect(localShortDate(MOMENT)).toBe("Oct 24, 2026");
  });

  it("localDateAtTime: the date, then the time with two-digit hours", () => {
    expect(plain(localDateAtTime(MOMENT))).toBe("Oct 24, 2026 at 03:30 PM");
  });

  it("localTimestamp: the month short, the time with an unpadded hour", () => {
    expect(plain(localTimestamp(MOMENT))).toBe("Oct 24, 2026, 3:30 PM");
  });

  it("follow the reader's locale", () => {
    vi.restoreAllMocks();
    readerSpeaks("de-DE");
    expect(absoluteDate(MOMENT)).toBe("24. Oktober 2026");
    expect(localShortDate(MOMENT)).toBe("24. Okt. 2026");
  });
});

describe("the date-only functions", () => {
  beforeEach(() => readerSpeaks("en-US"));

  it("read a timestamp as it is", () => {
    expect(localShortDateOfDay(MOMENT)).toBe("Oct 24, 2026");
    expect(absoluteDateOfDay(MOMENT)).toBe("October 24, 2026");
  });

  it("read a date-only string as that day, not the day before, west of UTC", () => {
    env.TZ = "America/Los_Angeles";
    expect(localShortDateOfDay(DAY)).toBe("Oct 24, 2026");
    expect(absoluteDateOfDay(DAY)).toBe("October 24, 2026");
    // What they are for: read as midnight UTC, this day is still the 23rd in Los Angeles.
    expect(new Date(DAY).toLocaleDateString("en-US", { day: "numeric" })).toBe("23");
  });
});
