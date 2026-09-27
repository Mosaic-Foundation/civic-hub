// A small RFC 4180 CSV reader and writer, for the jurisdiction files
// (scripts/build-jurisdictions.ts, scripts/load-jurisdictions.ts). Quoted
// fields may hold commas, quotes ("") and newlines. No dependency.

/** Parse CSV text into rows of fields. A trailing newline makes no empty row. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rows as objects keyed by the header row. */
export function parseCsvObjects(text: string, delimiter = ","): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text, delimiter);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

function quote(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV text, LF line endings, a trailing newline. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [header, ...rows].map((r) => r.map(quote).join(",")).join("\n") + "\n";
}
