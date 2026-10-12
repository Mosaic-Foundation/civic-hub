// Strip values out of an error message before it is reported (Audit 4).
//
// reportError() goes to the deployment log today and to error tracking later,
// so it must never carry a person's data. Database messages can: a unique
// violation's detail names the duplicated email, a bad-input message quotes
// the value, an id names a row. This keeps the shape of the message (which
// table, which constraint, which kind of failure) and replaces anything that
// looks like a value. Pure; pinned by tests/unit/redact.test.ts.

const RULES: Array<[RegExp, string]> = [
  // Postgres detail: Key (email)=(someone@example.com) already exists.
  [/=\([^)]*\)/g, "=(…)"],
  // Quoted values: "abc", 'abc', `abc`.
  [/"[^"]*"/g, '"…"'],
  [/'[^']*'/g, "'…'"],
  [/`[^`]*`/g, "`…`"],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // URLs, which can carry ids and query values.
  [/\bhttps?:\/\/\S+/g, "[url]"],
  // UUIDs.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  // Prefixed ids (proc_…, user_…, rev_…): keep the prefix, drop the id. An id
  // has a digit in it; a name like search_processes does not.
  [/\b([a-z]+)_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}\b/g, "$1_[id]"],
  // Long tokens and hashes (with a digit, so long snake_case names survive).
  [/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g, "[token]"],
  // Numbers of four or more digits (phone numbers, codes, counts that identify).
  [/\b\d{4,}\b/g, "[n]"],
];

export function redactValues(message: string): string {
  let out = message;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}
