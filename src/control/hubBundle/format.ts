// The hub export bundle — one hub's data as a documented set of files
// (exit rights; BUILD-PLAN-multi-tenant.md → Phase 5 → "Part two").
//
// This module is the format's one definition: the layout, the manifest, which
// rows and columns are left out and why, who owns which stored image, how an
// image's key maps onto the importing install, and the content fingerprint
// both ends compute. It reads and writes nothing itself; the exporter
// (./export.ts) and the importer (scripts/lib/hubImport.ts) do, through it.
//
// Layout of a bundle (a directory; the .tar.gz form packs the same tree):
//
//   README.md              what every file is, what was left out and why
//   manifest.json          format + version, source, per-table counts and
//                          checksums, omissions, image summary, fingerprint
//   hub.json               the hub's `hubs` row
//   tables/<table>.jsonl   one JSON object per row, one row per line
//   images.json            every stored object the hub owns, with its owner
//   images/<source key>    the objects' bytes
//
// Change the format → bump BUNDLE_FORMAT_VERSION and teach the importer the
// old one; a bundle is a promise to whoever holds it, not a cache.

import { createHash } from "node:crypto";
import { EXPORT_MANIFEST } from "../../db/schemaContract.js";
import { isSampleRow, type SampleIds } from "../../models/sampleContent.js";

export const BUNDLE_FORMAT = "civic-hub-export";
export const BUNDLE_FORMAT_VERSION = 1;

export type Row = Record<string, unknown>;

// --- What leaves, and what does not ----------------------------------------

/**
 * Each exported table's primary key, in key order: the order rows are read
 * (stable paging) and written in. tests/unit/hubBundle.test.ts checks every
 * exported table has one.
 */
export const TABLE_KEYS: Readonly<Record<string, readonly string[]>> = {
  active_vote_keys: ["user_id", "process_id"],
  brief_responses: ["id"],
  community_inputs: ["id"],
  deliberation_drafts: ["id"],
  deliberation_submissions: ["process_id", "user_id"],
  deliberation_votes: ["process_id", "user_id", "statement_id"],
  events: ["id"],
  feedback_submissions: ["id"],
  hub_admin_audit_log: ["id"],
  hub_settings: ["hub_id", "key"],
  process_links: ["id"],
  process_reviews: ["id"],
  processes: ["id"],
  project_comments: ["id"],
  project_drafts: ["id"],
  project_sentiments: ["project_id", "user_id"],
  project_updates: ["id"],
  projects: ["id"],
  proposal_drafts: ["id"],
  proposal_supports: ["proposal_id", "user_id"],
  proposals: ["id"],
  review_turns: ["id"],
  users: ["id"],
  vote_drafts: ["id"],
  vote_participation: ["user_id", "process_id"],
  vote_records: ["receipt_id"],
  waitlist: ["email"],
  wordcloud_submissions: ["id"],
};

/** The tables whose rows leave with an export, in manifest order. */
export function exportedTables(): string[] {
  return EXPORT_MANIFEST.filter((e) => e.rows === "export").map((e) => e.table);
}

/** The tables deliberately left behind, with why. */
export function omittedTables(): Array<{ table: string; reason: string }> {
  return EXPORT_MANIFEST.filter((e) => e.rows === "omit").map((e) => ({
    table: e.table,
    reason: e.reason ?? "",
  }));
}

/**
 * Columns that are not data: derived by the database from other columns, so
 * the importing install rebuilds them and an export that carried them would
 * only carry a stale copy.
 */
export const EXCLUDED_COLUMNS: ReadonlyArray<{ table: string; column: string; reason: string }> = [
  {
    table: "processes",
    column: "search_doc",
    reason: "the full-text search index, rebuilt from title, description and state by a trigger on insert",
  },
];

export function isExcludedColumn(table: string, column: string): boolean {
  return EXCLUDED_COLUMNS.some((c) => c.table === table && c.column === column);
}

/**
 * A setting that is a secret by its name. Credentials are env vars by design
 * (BUILD-PLAN → "Per-plugin credentials"), so no current key matches; this
 * is the net under a legacy row (the old demo bypass code) or a future
 * mistake. The key is listed in the manifest; its value never leaves.
 */
const SECRET_SETTING = /(^|[._-])(bypass|secret|token|password|passwd|api[_-]?key|credential|private[_-]?key)s?([._-]|$)/i;

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING.test(key);
}

/**
 * Sample content — rows seeded to show a hub off (a demo's starter votes),
 * not written by its people — stays behind (Phase 7). The marker is
 * `is_sample` on processes, events and users; every other sample row belongs
 * to a sample process (src/models/sampleContent.ts, the one list removal uses
 * too), so the exporter reads the hub's sample process and user ids first
 * and passes them in. It counts what this skips into the manifest per table.
 */
export function isSampleContentRow(table: string, row: Row, ids: SampleIds): boolean {
  return isSampleRow(table, row, ids);
}

// --- Stored images: who owns what -----------------------------------------

export type ImageOwnershipRule =
  | "hub-prefix" //         <hub>/…            (Phase 2b onward)
  | "legacy-hubs-folder" // hubs/<hub>/…       (banners/logos, Phase 1 part five)
  | "legacy-unprefixed"; // YYYY/MM/…          (post images before Phase 2b)

/**
 * The owner of an object key, by the rule recorded in the build plan (Phase
 * 2c, "Objects stored before the prefix"): `<hub>/…` and `hubs/<hub>/…`
 * belong to `<hub>`; a key with no hub prefix (`YYYY/MM/…`) belongs to the
 * migration-default hub. Null for anything else (another bucket layout).
 */
export function imageOwner(
  key: string,
  migrationDefaultHubId: string,
): { owner: string; rule: ImageOwnershipRule } | null {
  const parts = key.split("/");
  if (parts.length < 2 || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  if (/^\d{4}$/.test(parts[0])) return { owner: migrationDefaultHubId, rule: "legacy-unprefixed" };
  if (parts[0] === "hubs") {
    return parts.length >= 3 ? { owner: parts[1], rule: "legacy-hubs-folder" } : null;
  }
  return { owner: parts[0], rule: "hub-prefix" };
}

/**
 * Where an object lands on the importing install: always under the hub's
 * own prefix (the planning session, 2026-09-26), so an imported hub never
 * depends on the old host and the target's storage policies cover it.
 * `hubs/<hub>/X` → `<hub>/identity/X` (what those objects are: banners and
 * logos, whose new home is `<hub>/identity/`); `YYYY/MM/X` → `<hub>/YYYY/MM/X`.
 * Keys end in a random UUID, so neither mapping can collide.
 */
export function targetImageKey(sourceKey: string, hubId: string, rule: ImageOwnershipRule): string {
  switch (rule) {
    case "hub-prefix":
      return sourceKey;
    case "legacy-hubs-folder":
      return `${hubId}/identity/${sourceKey.split("/").slice(2).join("/")}`;
    case "legacy-unprefixed":
      return `${hubId}/${sourceKey}`;
  }
}

/** `<storage base>/storage/v1/object/public/<bucket>/` — what a stored URL starts with. */
export function publicObjectPrefix(storageBaseUrl: string, bucket: string): string {
  return `${storageBaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
}

// --- The manifest -----------------------------------------------------------

export interface BundleTable {
  table: string;
  file: string;
  rows: number;
  columns: string[];
  sha256: string;
  skipped_sample_rows: number;
}

export interface BundleImage {
  source_key: string;
  target_key: string;
  file: string;
  owner: string;
  rule: ImageOwnershipRule;
  content_type: string;
  size: number;
  sha256: string;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  format_version: number;
  exported_at: string;
  exported_by: string;
  source: {
    kind: "supabase" | "postgres";
    /** The storage host stored image URLs point at; null when images were not read. */
    storage_base_url: string | null;
    bucket: string;
    commit: string | null;
  };
  hub_id: string;
  tables: BundleTable[];
  omitted_tables: Array<{ table: string; reason: string }>;
  excluded_columns: Array<{ table: string; column: string; reason: string }>;
  excluded_settings: Array<{ key: string; reason: string }>;
  images: {
    file: "images.json";
    count: number;
    bytes: number;
    /** Set when the export could not read storage: why, so the gap is explicit. */
    not_included_reason: string | null;
  };
  /** sha256 over every table's rows, image URLs normalized; see fingerprintTables(). */
  fingerprint: string;
}

export function tableFile(table: string): string {
  return `tables/${table}.jsonl`;
}

export function imageFile(sourceKey: string): string {
  return `images/${sourceKey}`;
}

// --- Canonical form and the fingerprint -----------------------------------

/** JSON with object keys sorted at every depth: equal data, equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Row).sort()) out[k] = sortKeys((value as Row)[k]);
    return out;
  }
  return value;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Replaces every stored image URL with a host-free token, so a fingerprint
 * taken on the source (URLs on the old storage host) equals one taken on the
 * target (URLs rewritten to the new host and key). `urlToToken` maps a full
 * public URL to `civic-bundle-image:<source key>`.
 */
export function imageUrlNormalizer(
  entries: Array<{ url: string; sourceKey: string }>,
): (text: string) => string {
  if (entries.length === 0) return (t) => t;
  const map = new Map(entries.map((e) => [e.url, `civic-bundle-image:${e.sourceKey}`]));
  const pattern = new RegExp(
    [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"),
    "g",
  );
  return (text) => text.replace(pattern, (m) => map.get(m) ?? m);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The content fingerprint: sha256 over each table's rows in canonical form,
 * sorted, with excluded columns dropped and image URLs normalized. The same
 * data on any install yields the same value, whatever order it was read in.
 */
export function fingerprintTables(
  tables: Array<{ table: string; rows: Row[] }>,
  normalize: (text: string) => string = (t) => t,
): string {
  const hash = createHash("sha256");
  for (const { table, rows } of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    const lines = rows
      .map((r) => normalize(canonicalJson(withoutExcluded(table, r))))
      .sort();
    hash.update(`# ${table} ${lines.length}\n`);
    for (const line of lines) hash.update(`${line}\n`);
  }
  return hash.digest("hex");
}

export function withoutExcluded(table: string, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!isExcludedColumn(table, k)) out[k] = v;
  return out;
}

export function toJsonl(rows: Row[]): string {
  return rows.map((r) => `${JSON.stringify(r)}\n`).join("");
}

export function parseJsonl(text: string): Row[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Row);
}

// --- README -----------------------------------------------------------------

export function renderReadme(m: BundleManifest, hub: Row): string {
  const tableLines = m.tables
    .map((t) => `| \`${t.file}\` | ${t.rows} | ${t.skipped_sample_rows || ""} |`)
    .join("\n");
  const omitted = m.omitted_tables.map((o) => `- \`${o.table}\` — ${o.reason}`).join("\n");
  const cols = m.excluded_columns.map((c) => `- \`${c.table}.${c.column}\` — ${c.reason}`).join("\n");
  const settings = m.excluded_settings.length
    ? m.excluded_settings.map((s) => `- \`${s.key}\` — ${s.reason}`).join("\n")
    : "- none in this export (every setting name was checked; secret-shaped names are dropped)";
  const images = m.images.not_included_reason
    ? `**Images were not included:** ${m.images.not_included_reason}`
    : `${m.images.count} objects, ${m.images.bytes} bytes.`;

  return `# Civic Hub export — ${String(hub.name ?? m.hub_id)} (\`${m.hub_id}\`)

This directory is one hub's data, exported ${m.exported_at} by ${m.exported_by}.
Format \`${m.format}\`, **version ${m.format_version}**. It can be loaded into
another Civic Hub install (Supabase or plain Postgres) with
\`scripts/import-hub.ts\` from the civic-hub repository, or read with any tool
that understands JSON.

**This bundle contains personal data** — residents' email addresses and names,
their comments, their participation records. Store and move it the way the
hub's privacy policy promises.

## Files

| File | What it is |
|---|---|
| \`README.md\` | this file |
| \`manifest.json\` | format and version, where it came from, every table's row count, columns and sha256, what was left out, the image summary, and the content fingerprint |
| \`hub.json\` | the hub's row in the \`hubs\` registry: id, hostname, name, jurisdiction (name, code, and \`jurisdiction_ocd_id\`: its Open Civic Data division id, or null), DID, mode, status. An import needs that OCD id on the target's jurisdiction list (\`scripts/load-jurisdictions.ts\`) |
| \`tables/<table>.jsonl\` | one table's rows for this hub: one JSON object per line, keys = column names, values as Postgres renders them in JSON (timestamps ISO 8601 with offset) |
| \`images.json\` | every stored object the hub owns: its key at the source, the key it takes on import, its owner and the rule that says so, type, size, sha256 |
| \`images/<key>\` | the objects' bytes, at their source key |

### Tables

| File | Rows | Sample rows left out |
|---|---|---|
${tableLines}

The hub's settings are \`tables/hub_settings.jsonl\` (values are text: lists
are JSON arrays, booleans \`true\`/\`false\`, numbers decimal strings).

## Left out, and why

Whole tables:
${omitted}

Columns:
${cols}

Settings (secrets never leave; a setting whose name is secret-shaped is dropped):
${settings}

Sample content (rows seeded to demonstrate a hub, not written by its people)
is left out once such rows are marked; the counts are per table above.

Sign-in secrets live only in the tables above that are omitted (\`sessions\`,
\`pending_verifications\`). Platform credentials (API keys, signing keys) are
environment variables of the deployment and were never in the database.

## Images

${images}

Ownership: \`<hub>/…\` and \`hubs/<hub>/…\` belong to \`<hub>\`; a key with no hub
prefix (\`YYYY/MM/…\`, stored before hubs had prefixes) belongs to the hub the
original single-hub database was converted from. On import every object goes
under the hub's own prefix, and every stored URL that points at one of these
objects is rewritten to the new install's storage, so the imported hub does
not depend on the old host.

## The fingerprint

\`manifest.json → fingerprint\` is a sha256 over every table's rows in canonical
form (keys sorted, rows sorted, excluded columns dropped, image URLs replaced
by \`civic-bundle-image:<source key>\`). The importer recomputes it from the
rows it wrote, so a load that lost or changed anything is caught.
`;
}
