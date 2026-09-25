// Validate a hub admin's settings write before anything is stored.
//
// Pure — no database, no request — so the rules that decide what an admin may
// write are tested directly. The endpoint (src/controllers/hubSettingsController.ts)
// calls this and stores exactly what it returns, or nothing.
//
// ALL OR NOTHING. A write with one bad value writes no value at all: a section
// is saved as one form, and half a form saved is a state the admin never saw.

import { isValidTimeZone } from "../utils/hubTime.js";
import {
  DEFAULT_TEXT_MAX_LENGTH,
  DOCUMENT_MAX_LENGTH,
  SETTINGS_SECTIONS,
  fieldSpec,
  isSettingsSectionId,
  type SettingFieldSpec,
  type SettingsSectionId,
} from "../shared/hubSettingsSections.js";
import { validateThemeValue } from "../shared/theme.js";

export type SettingsWriteResult =
  | {
      ok: true;
      section: SettingsSectionId;
      entries: Array<{ key: string; value: string }>;
    }
  | {
      ok: false;
      error: string;
      /** Keys the endpoint does not know at all, when that is the problem. */
      unknownKeys?: string[];
    };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_SHAPE = /^#[0-9a-f]{6}$/i;

/**
 * Check a write of `values` to `section`.
 *
 * Refuses, in this order: an unknown section; any key the build plan does not
 * list (named, so the caller can see which); a known key that belongs to a
 * different section — saving a form writes only that form's keys; an empty
 * write; and then each value against its kind.
 */
export function validateSettingsWrite(
  section: unknown,
  values: unknown,
): SettingsWriteResult {
  if (!isSettingsSectionId(section)) {
    return { ok: false, error: `Unknown settings section "${String(section)}".` };
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { ok: false, error: "values must be an object of { key: value }." };
  }

  const input = values as Record<string, unknown>;
  const keys = Object.keys(input);

  const unknownKeys = keys.filter((k) => !fieldSpec(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `Unknown setting${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}. Nothing was saved.`,
      unknownKeys,
    };
  }

  const sectionSpecs = SETTINGS_SECTIONS[section];
  const outside = keys.filter((k) => !sectionSpecs.some((f) => f.key === k));
  if (outside.length > 0) {
    return {
      ok: false,
      error: `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not in the ${section} section. Nothing was saved.`,
    };
  }

  if (keys.length === 0) {
    return { ok: false, error: "Nothing to save." };
  }

  const entries: Array<{ key: string; value: string }> = [];
  for (const spec of sectionSpecs) {
    if (!(spec.key in input)) continue;
    const result = normalizeValue(spec, input[spec.key]);
    if (typeof result === "object") return { ok: false, error: result.error };
    entries.push({ key: spec.key, value: result });
  }
  return { ok: true, section, entries };
}

/**
 * One value, as it will be stored, or why it cannot be.
 *
 * An empty string is a real value for every kind that allows it: it clears the
 * hub's own row and returns it to the default (the shared template, the
 * registry name, today's colours). Booleans and hours have no "unset" in the
 * form, so they are always stored.
 */
export function normalizeValue(
  spec: SettingFieldSpec,
  raw: unknown,
): string | { error: string } {
  const key = spec.key;

  switch (spec.kind) {
    case "boolean": {
      if (raw === true || raw === "true") return "true";
      if (raw === false || raw === "false") return "false";
      return { error: `${key} must be true or false.` };
    }

    case "hour": {
      // Number("") is 0, so an empty string must be refused before it is
      // read as midnight.
      const n =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw.trim())
            : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        return { error: `${key} must be a whole hour from 0 to 23.` };
      }
      return String(n);
    }

    case "number": {
      const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
      if (s === null) return { error: `${key} must be a whole number.` };
      if (s === "") return "";
      const n = Number(s);
      const lo = spec.min ?? Number.MIN_SAFE_INTEGER;
      const hi = spec.max ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isInteger(n) || n < lo || n > hi) {
        return { error: `${key} must be a whole number from ${lo} to ${hi}.` };
      }
      return String(n);
    }

    case "timezone": {
      if (typeof raw !== "string") return { error: `${key} must be a string.` };
      const v = raw.trim();
      if (v !== "" && !isValidTimeZone(v)) {
        return { error: `${key} must be a time zone name such as America/New_York.` };
      }
      return v;
    }

    case "theme": {
      // An object or its JSON; stored canonical, "" for the default palette.
      const result = validateThemeValue(raw);
      return "error" in result ? { error: result.error } : result.value;
    }

    default:
      break;
  }

  if (typeof raw !== "string") return { error: `${key} must be a string.` };

  switch (spec.kind) {
    case "text": {
      const v = raw.trim();
      if (/[\r\n]/.test(v)) return { error: `${key} must be one line.` };
      return withinLength(key, v, spec.maxLength ?? DEFAULT_TEXT_MAX_LENGTH);
    }

    case "textarea":
    case "markdown": {
      const v = raw.replace(/\r\n/g, "\n").trim();
      return withinLength(key, v, spec.maxLength ?? DOCUMENT_MAX_LENGTH);
    }

    case "document": {
      // Documents keep their trailing newline convention, but not stray
      // whitespace around them: the golden copies are compared byte for byte.
      const v = raw.replace(/\r\n/g, "\n").trim();
      return withinLength(key, v === "" ? "" : `${v}\n`, spec.maxLength ?? DOCUMENT_MAX_LENGTH);
    }

    case "url": {
      const v = raw.trim();
      if (v === "") return "";
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return { error: `${key} must be a full web address starting with https://.` };
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        return { error: `${key} must be a full web address starting with https://.` };
      }
      return withinLength(key, v, spec.maxLength ?? 500);
    }

    case "choice": {
      const v = raw.trim();
      if (v === "" || (spec.options ?? []).includes(v)) return v;
      return { error: `${key} must be one of: ${(spec.options ?? []).join(", ")}.` };
    }

    case "date": {
      const v = raw.trim();
      if (v === "") return "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        return { error: `${key} must be a date, YYYY-MM-DD.` };
      }
      return v;
    }

    case "email": {
      const v = raw.trim().toLowerCase();
      // Shape-checked, not verified. What this catches is a value that is not
      // an address at all, which would render as prose in a legal document.
      if (v !== "" && !EMAIL_SHAPE.test(v)) {
        return { error: `"${v}" is not an email address.` };
      }
      return v;
    }

    case "color": {
      const v = raw.trim().toLowerCase();
      if (v !== "" && !COLOR_SHAPE.test(v)) {
        return { error: `${key} must be a colour like #1f5f8b.` };
      }
      return v;
    }

    case "image": {
      const v = raw.trim();
      if (v === "") return "";
      // An uploaded image comes back as an absolute https URL; a root-relative
      // path is what the seeded hubs use for a banner shipped in ui/public/.
      // Anything else — another scheme, a protocol-relative URL — is refused:
      // the value becomes an <img src> on every page.
      if (v.startsWith("/") && !v.startsWith("//")) return withinLength(key, v, 500);
      try {
        const url = new URL(v);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          return { error: `${key} must be an http(s) URL.` };
        }
      } catch {
        return { error: `${key} must be an uploaded image's URL.` };
      }
      return withinLength(key, v, 500);
    }

    default:
      return { error: `${key} has no validator.` };
  }
}

function withinLength(key: string, value: string, max: number): string | { error: string } {
  if (value.length > max) {
    return { error: `${key} is ${value.length} characters; the limit is ${max}.` };
  }
  return value;
}
