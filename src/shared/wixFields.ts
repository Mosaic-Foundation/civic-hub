// Which columns of a Wix meetings collection hold what (the cleanup slice,
// 2026-10-16). The wix-cms connector was written against the first hub's
// collection; another site names its columns differently. The setting
// `plugin.meeting_summary.wix_fields` names them, one role at a time:
//
//   date=title1, type=title, agenda=agendaPdf, minutes=minutesPdf,
//   video=recording1, more_video=recording21 recording31
//
// A role left out keeps its default, which is the first hub's column, so an
// unset value reads exactly as before. Shared by the server (the connector
// and the save's check) and the settings page. Pure.

export interface WixFieldMap {
  /** The meeting's date, as Wix displays it ("August 11, 2026"). */
  date: string;
  /** The meeting's type or title ("Regular Meeting"). */
  type: string;
  agenda: string;
  minutes: string;
  /** The first recording. */
  video: string;
  /** Further recordings of the same meeting, in order. */
  more_video: string[];
}

export const DEFAULT_WIX_FIELDS: Readonly<WixFieldMap> = Object.freeze({
  date: "title1",
  type: "title",
  agenda: "agendaPdf",
  minutes: "minutesPdf",
  video: "recording1",
  more_video: ["recording21", "recording31"],
});

const ROLES = ["date", "type", "agenda", "minutes", "video", "more_video"] as const;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Parse the setting. Errors name the part that is wrong; the save refuses a
 * value with any, and the connector falls back to the defaults for it.
 */
export function parseWixFields(raw: string | null | undefined): { fields: WixFieldMap; errors: string[] } {
  const fields: WixFieldMap = { ...DEFAULT_WIX_FIELDS, more_video: [...DEFAULT_WIX_FIELDS.more_video] };
  const errors: string[] = [];
  for (const part of (raw ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const role = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase().replace(/[\s-]+/g, "_");
    const value = eq === -1 ? "" : part.slice(eq + 1).trim();
    if (!(ROLES as readonly string[]).includes(role)) {
      errors.push(`"${part}": the part before = must be one of ${ROLES.join(", ")}`);
      continue;
    }
    const columns = value.split(/\s+/).filter(Boolean);
    if (columns.length === 0 || columns.some((c) => !COLUMN.test(c))) {
      errors.push(`"${part}": name a column after =, letters, digits and _ only`);
      continue;
    }
    if (role === "more_video") fields.more_video = columns;
    else if (columns.length > 1) errors.push(`"${part}": ${role} takes one column`);
    else fields[role as Exclude<(typeof ROLES)[number], "more_video">] = columns[0]!;
  }
  return { fields, errors };
}
