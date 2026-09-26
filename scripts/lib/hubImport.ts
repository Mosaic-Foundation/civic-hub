// @civic-raw-client-importer: import writes a hub's objects into the target install's bucket with that install's service key.
//
// Loading a hub bundle (src/control/hubBundle/format.ts) into a database —
// the engine behind scripts/import-hub.ts and scripts/restore-hub.ts.
//
// It talks to Postgres directly with `pg` (ADR-005), so the same code loads a
// Supabase project (through its Postgres port) and a plain Postgres install.
// The target's own catalog decides the order rows go in (foreign keys), what
// counts as a conflict (every primary key and unique index), and which rows
// need their exact values put back after a BEFORE INSERT trigger rewrote them.
//
// THE GUARANTEES
//   - Nothing changes unless everything can: the conflict check runs first
//     and is read-only; the rows, the audit row and the verification run in
//     one transaction; objects uploaded before it are removed if it fails.
//   - Import stops on ANY conflict (an id, an email, a hostname, an object
//     key already on the target) and says which.
//   - What went in is proved before commit: row counts per table and the
//     content fingerprint, recomputed from the target, must equal the
//     bundle's.
//   - Every import and every restore writes a `control_audit_log` row.
//
// Two statements run with `session_replication_role = replica` (triggers and
// foreign-key checks suspended), each narrowly: putting back the exact
// values a BEFORE INSERT trigger overwrote (hub_settings.updated_at), and
// setting a column held back to break a foreign-key cycle
// (processes.review_id ↔ process_reviews.process_id). Both are followed by an
// explicit check of the foreign keys involved. Clearing the append-only
// tables is the restore's alone, behind --clear-append-only.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  fingerprintTables,
  imageUrlNormalizer,
  parseJsonl,
  publicObjectPrefix,
  sha256,
  type BundleImage,
  type BundleManifest,
  type Row,
} from "../../src/control/hubBundle/format.js";
import type { HubRowReader } from "../../src/control/hubBundle/export.js";
import { unpackTarGz } from "../../src/control/hubBundle/tar.js";

export class ImportRefused extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
  }
}

// --- Connections: from an env file, never the command line -----------------

/**
 * A connected client for the URL in `envVar`. The URL comes from the
 * environment (`node --env-file=<file>`), never from argv, so it does not
 * land in shell history; a URL on the command line is refused outright.
 */
export async function connectFromEnv(envVar: string, argv: readonly string[] = process.argv): Promise<pg.Client> {
  if (argv.some((a) => /^postgres(ql)?:\/\//i.test(a) || /postgres(ql)?:\/\//i.test(a.split("=")[1] ?? ""))) {
    throw new ImportRefused(
      "A database URL was given on the command line. Put it in an env file and run with node --env-file=<file>.",
    );
  }
  const url = process.env[envVar];
  if (!url) throw new ImportRefused(`${envVar} is not set. Put it in an env file and run with node --env-file=<file>.`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("set timezone to 'UTC'");
  return client;
}

/** Quote an identifier. Names come from the catalog and the manifest; quote anyway. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// --- Reading a hub straight from Postgres (export of a restored dump) ------

/**
 * The exporter's row reader over a direct connection. `to_jsonb` renders
 * values exactly as PostgREST does, so a bundle read this way and one read
 * through the Supabase API are the same bytes for the same data.
 */
export function pgRowReader(client: pg.Client): HubRowReader {
  return {
    kind: "postgres",
    async hubRow(hubId) {
      const r = await client.query("select to_jsonb(h) as r from hubs h where id = $1", [hubId]);
      return (r.rows[0]?.r as Row | undefined) ?? null;
    },
    async tableRows(table, hubId, key) {
      const order = key.map(ident).join(", ");
      const r = await client.query(
        `select to_jsonb(t) as r from ${ident(table)} t where hub_id = $1 order by ${order}`,
        [hubId],
      );
      return r.rows.map((x) => x.r as Row);
    },
  };
}

// --- The bundle, loaded and checked ------------------------------------------

export interface LoadedBundle {
  name: string;
  manifest: BundleManifest;
  hub: Row;
  tables: Map<string, Row[]>;
  images: BundleImage[];
  imageBytes: Map<string, Buffer>;
}

async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) files.set(relative(dir, p).split("\\").join("/"), await readFile(p));
    }
  }
  await walk(dir);
  return files;
}

/** Files of a bundle given as a directory or a .tar.gz, keyed by path inside the bundle. */
export async function readBundleFiles(path: string): Promise<{ name: string; files: Map<string, Buffer> }> {
  const s = await stat(path);
  if (s.isDirectory()) {
    return { name: path.replace(/\/+$/, "").split("/").pop() ?? path, files: await readTree(path) };
  }
  const entries = unpackTarGz(await readFile(path));
  // The archive holds one top-level directory: the bundle's name.
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  const single = tops.size === 1 ? [...tops][0] : null;
  const files = new Map<string, Buffer>();
  for (const e of entries) files.set(single ? e.path.slice(single.length + 1) : e.path, e.data);
  return { name: single ?? path.split("/").pop() ?? path, files };
}

/**
 * Parse and check a bundle: format and version known, every file present
 * with the checksum and row count the manifest records, every image's bytes
 * matching, and the fingerprint recomputed from the rows equal to the
 * manifest's. A bundle that fails is refused before any database is touched.
 */
export function checkBundle(name: string, files: Map<string, Buffer>): LoadedBundle {
  const need = (p: string): Buffer => {
    const b = files.get(p);
    if (!b) throw new ImportRefused(`Bundle is missing ${p}.`);
    return b;
  };
  const manifest = JSON.parse(need("manifest.json").toString("utf8")) as BundleManifest;
  if (manifest.format !== BUNDLE_FORMAT) throw new ImportRefused(`Not a hub bundle (format "${manifest.format}").`);
  if (manifest.format_version !== BUNDLE_FORMAT_VERSION) {
    throw new ImportRefused(
      `Bundle format version ${manifest.format_version}; this importer reads version ${BUNDLE_FORMAT_VERSION}.`,
    );
  }
  const problems: string[] = [];
  const hub = JSON.parse(need("hub.json").toString("utf8")) as Row;
  if (hub.id !== manifest.hub_id) problems.push(`hub.json is "${String(hub.id)}", manifest says "${manifest.hub_id}".`);

  const tables = new Map<string, Row[]>();
  for (const t of manifest.tables) {
    const body = need(t.file);
    if (sha256(body) !== t.sha256) problems.push(`${t.file}: checksum does not match the manifest.`);
    const rows = parseJsonl(body.toString("utf8"));
    if (rows.length !== t.rows) problems.push(`${t.file}: ${rows.length} rows, manifest says ${t.rows}.`);
    for (const r of rows) {
      if (r.hub_id !== manifest.hub_id) {
        problems.push(`${t.file}: a row belongs to hub "${String(r.hub_id)}".`);
        break;
      }
    }
    tables.set(t.table, rows);
  }

  const images = JSON.parse(need("images.json").toString("utf8")) as BundleImage[];
  const imageBytes = new Map<string, Buffer>();
  for (const img of images) {
    const b = need(img.file);
    if (sha256(b) !== img.sha256) problems.push(`${img.file}: checksum does not match images.json.`);
    imageBytes.set(img.source_key, b);
  }
  if (images.length !== manifest.images.count) {
    problems.push(`images.json lists ${images.length} objects, manifest says ${manifest.images.count}.`);
  }

  const normalize = sourceNormalizer(manifest, images);
  const fp = fingerprintTables([...tables].map(([table, rows]) => ({ table, rows })), normalize);
  if (fp !== manifest.fingerprint) problems.push("The rows' fingerprint does not match the manifest's.");

  if (problems.length) throw new ImportRefused("The bundle failed its own checks.", problems);
  return { name, manifest, hub, tables, images, imageBytes };
}

function sourceNormalizer(m: BundleManifest, images: BundleImage[]) {
  if (!m.source.storage_base_url) return undefined;
  const prefix = publicObjectPrefix(m.source.storage_base_url, m.source.bucket);
  return imageUrlNormalizer(images.map((i) => ({ url: prefix + i.source_key, sourceKey: i.source_key })));
}

// --- The target: catalog -----------------------------------------------------

interface Catalog {
  columns: Map<string, Map<string, { nullable: boolean }>>;
  uniques: Array<{ table: string; columns: string[] }>;
  fks: Array<{ table: string; columns: string[]; parent: string; parentColumns: string[] }>;
  beforeInsertTriggers: Set<string>;
  keys: Map<string, string[]>;
}

async function readCatalog(client: pg.Client): Promise<Catalog> {
  const cols = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
    "select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'",
  );
  const columns = new Map<string, Map<string, { nullable: boolean }>>();
  for (const c of cols.rows) {
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Map());
    columns.get(c.table_name)!.set(c.column_name, { nullable: c.is_nullable === "YES" });
  }

  const idx = await client.query<{ table: string; cols: string[] | null; primary: boolean; has_expr: boolean }>(`
    select c.relname as table, i.indisprimary as primary,
           bool_or(k.attnum = 0) as has_expr,
           array_agg(a.attname::text order by k.ord) filter (where a.attname is not null) as cols
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
      left join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
     where n.nspname = 'public' and i.indisunique
     group by c.relname, i.indexrelid, i.indisprimary`);
  // Partial unique indexes are checked as if full: stricter, never looser.
  const uniques = idx.rows
    .filter((r) => !r.has_expr && r.cols && r.cols.length > 0)
    .map((r) => ({ table: r.table, columns: r.cols! }));
  const keys = new Map<string, string[]>();
  for (const r of idx.rows) if (r.primary && r.cols) keys.set(r.table, r.cols);

  const fk = await client.query<{ table: string; parent: string; cols: string[]; pcols: string[] }>(`
    select c.relname as table, p.relname as parent,
           (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(n, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n) as cols,
           (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(n, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n) as pcols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class p on p.oid = con.confrelid
     where con.contype = 'f' and con.connamespace = 'public'::regnamespace`);
  const fks = fk.rows.map((r) => ({ table: r.table, columns: r.cols, parent: r.parent, parentColumns: r.pcols }));

  // tgtype bits: 1 row, 2 before, 4 insert.
  const trg = await client.query<{ table: string }>(`
    select distinct c.relname as table from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D'
       and (t.tgtype & 7) = 7`);
  return { columns, uniques, fks, beforeInsertTriggers: new Set(trg.rows.map((r) => r.table)), keys };
}

/**
 * Insert order: parents before children over the target's foreign keys. A
 * cycle is broken at a foreign key whose columns (hub_id aside) are all
 * nullable: those columns go in as null and are set once both sides exist.
 */
export function insertOrder(
  tables: string[],
  fks: Catalog["fks"],
  isNullable: (table: string, column: string) => boolean,
): { order: string[]; deferred: Array<{ table: string; columns: string[] }> } {
  const set = new Set(tables);
  let edges = fks.filter((f) => set.has(f.table) && set.has(f.parent) && f.table !== f.parent);
  const order: string[] = [];
  const deferred: Array<{ table: string; columns: string[] }> = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((t) => !edges.some((e) => e.table === t && remaining.has(e.parent)))
      .sort();
    if (ready.length) {
      for (const t of ready) {
        order.push(t);
        remaining.delete(t);
      }
      continue;
    }
    const breakable = edges.find(
      (e) =>
        remaining.has(e.table) &&
        remaining.has(e.parent) &&
        e.columns.filter((c) => c !== "hub_id").every((c) => isNullable(e.table, c)),
    );
    if (!breakable) throw new ImportRefused(`Foreign keys form a cycle with no nullable column: ${[...remaining].join(", ")}.`);
    const cols = breakable.columns.filter((c) => c !== "hub_id");
    const existing = deferred.find((d) => d.table === breakable.table);
    if (existing) existing.columns = [...new Set([...existing.columns, ...cols])];
    else deferred.push({ table: breakable.table, columns: cols });
    // Every edge from that table over those columns is satisfied later.
    edges = edges.filter(
      (e) => !(e.table === breakable.table && e.columns.filter((c) => c !== "hub_id").every((c) => cols.includes(c))),
    );
  }
  return { order, deferred };
}

// --- The target: storage -----------------------------------------------------

export interface TargetStorage {
  bucket: string;
  publicUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  upload(key: string, bytes: Buffer, contentType: string, upsert: boolean): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/**
 * The target install's bucket, from CIVIC_TARGET_SUPABASE_URL and
 * CIVIC_TARGET_SERVICE_ROLE_KEY (and CIVIC_TARGET_STORAGE_BUCKET, default
 * post-images). Null when the env names no storage — a plain Postgres install.
 */
export function targetStorageFromEnv(): TargetStorage | null {
  const url = process.env.CIVIC_TARGET_SUPABASE_URL;
  const key = process.env.CIVIC_TARGET_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const bucket = process.env.CIVIC_TARGET_STORAGE_BUCKET || "post-images";
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = () => sb.storage.from(bucket);
  return {
    bucket,
    publicUrl: (k) => publicObjectPrefix(url, bucket) + k,
    async exists(k) {
      // A missing object comes back as an error, worded "Bad Request" or "not
      // found" depending on the Storage version; anything else is a real failure.
      const { data, error } = await store().exists(k);
      if (error && !/not.?found|bad request|400|404/i.test(error.message)) throw new Error(`storage: ${error.message}`);
      return data === true;
    },
    async upload(k, bytes, contentType, upsert) {
      const { error } = await store().upload(k, bytes, { contentType, upsert, cacheControl: "31536000, immutable" });
      if (error) throw new Error(`storage upload ${k}: ${error.message}`);
    },
    async remove(keys) {
      if (keys.length) await store().remove(keys);
    },
  };
}

// --- Plan: everything that can be known without writing ---------------------

export type ImportMode = "import" | "restore";

export interface ImportOptions {
  mode: ImportMode;
  /** Replace the hub's hostname (a hub arriving at a new host). Import only. */
  hostname?: string;
  storage: TargetStorage | null;
  /** Load rows without images (a target with no storage). URLs stay as they were. */
  noImages?: boolean;
  clearAppendOnly?: boolean;
  actor: string;
}

export interface ImportPlan {
  catalog: Catalog;
  order: string[];
  deferred: Array<{ table: string; columns: string[] }>;
  hubRow: Row;
  /** Rows as they will be written: image URLs rewritten to the target. */
  rows: Map<string, Row[]>;
  /** For restore: the hub's rows now on the target, per table (what gets cleared). */
  existing: Record<string, number>;
  imageUploads: Array<{ key: string; bytes: Buffer; contentType: string }>;
  targetNormalize: ((t: string) => string) | undefined;
}

const APPEND_ONLY = ["events", "review_turns"];

/**
 * Everything checked before anything is written: the target's schema can
 * hold the bundle, no key the bundle brings already exists there (for a
 * restore, outside the hub's own rows, which are about to be cleared), the
 * hostname is free, and — for a restore — the append-only tables may be
 * cleared. Throws ImportRefused listing every problem found.
 */
export async function planImport(client: pg.Client, b: LoadedBundle, opts: ImportOptions): Promise<ImportPlan> {
  const catalog = await readCatalog(client);
  const hubId = b.manifest.hub_id;
  const problems: string[] = [];

  if (!opts.noImages && b.images.length && !opts.storage) {
    throw new ImportRefused(
      "The bundle has images and the target names no storage (CIVIC_TARGET_SUPABASE_URL / CIVIC_TARGET_SERVICE_ROLE_KEY). " +
        "Set them, or pass --no-images to load the rows alone (image URLs then keep pointing at the old host).",
    );
  }
  if (!catalog.columns.has("control_audit_log")) {
    problems.push("The target has no control_audit_log table; every import is recorded there. Apply the migrations first.");
  }

  // Schema: every table and column the bundle brings must exist on the target.
  const hubCols = catalog.columns.get("hubs");
  if (!hubCols) problems.push("The target has no hubs table.");
  else for (const c of Object.keys(b.hub)) if (!hubCols.has(c)) problems.push(`Target hubs has no column "${c}".`);
  for (const t of b.manifest.tables) {
    const cols = catalog.columns.get(t.table);
    if (!cols) {
      if (t.rows) problems.push(`Target has no table "${t.table}" (${t.rows} rows to load).`);
      continue;
    }
    for (const c of t.columns) if (!cols.has(c)) problems.push(`Target ${t.table} has no column "${c}".`);
  }
  if (problems.length) throw new ImportRefused("The target's schema cannot hold this bundle.", problems);

  // The hub row.
  const existingHub = await client.query("select id, hostname from hubs where id = $1", [hubId]);
  let hubRow: Row = { ...b.hub };
  if (opts.mode === "import") {
    if (opts.hostname) hubRow = { ...hubRow, hostname: opts.hostname.toLowerCase() };
    if (existingHub.rowCount) problems.push(`hubs: a hub "${hubId}" already exists on the target.`);
    for (const u of catalog.uniques.filter((u) => u.table === "hubs")) {
      const vals = u.columns.map((c) => hubRow[c]);
      if (vals.some((v) => v === null || v === undefined)) continue;
      const where = u.columns.map((c, i) => `${ident(c)} = $${i + 1}`).join(" and ");
      const r = await client.query(`select id from hubs where ${where}`, vals);
      for (const row of r.rows) {
        if (row.id !== hubId) problems.push(`hubs: ${u.columns.join(", ")} = ${vals.join(", ")} is taken by hub "${row.id}".`);
      }
    }
    // A hostname once used by another hub stays taken (Phase 5 part one).
    const moved = await client.query(
      "select target_hub_id from control_audit_log where before->>'hostname' = $1 and target_hub_id is distinct from $2 limit 1",
      [hubRow.hostname, hubId],
    );
    if (moved.rowCount) problems.push(`hubs: hostname ${String(hubRow.hostname)} was used by hub "${moved.rows[0].target_hub_id}" and stays taken.`);
  } else if (!existingHub.rowCount) {
    problems.push(`Restore needs the hub "${hubId}" to exist on the target; import it instead.`);
  } else {
    // Restore keeps the registry row as it is on the target: the console owns it.
    hubRow = { ...b.hub, ...existingHub.rows[0] };
  }

  // Images: where each goes, and the URL map.
  const imageUploads: ImportPlan["imageUploads"] = [];
  let rewrite = (t: string) => t;
  let targetNormalize: ((t: string) => string) | undefined = sourceNormalizer(b.manifest, b.images);
  if (!opts.noImages && b.images.length && opts.storage) {
    const storage = opts.storage;
    const src = publicObjectPrefix(b.manifest.source.storage_base_url ?? "", b.manifest.source.bucket);
    const map = new Map(b.images.map((i) => [src + i.source_key, storage.publicUrl(i.target_key)]));
    const pattern = new RegExp(
      [...map.keys()].sort((x, y) => y.length - x.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "g",
    );
    if (b.manifest.source.storage_base_url) rewrite = (t) => t.replace(pattern, (m) => map.get(m) ?? m);
    targetNormalize = imageUrlNormalizer(
      b.images.map((i) => ({ url: storage.publicUrl(i.target_key), sourceKey: i.source_key })),
    );
    for (const img of b.images) {
      if (!img.target_key.startsWith(`${hubId}/`)) problems.push(`images: ${img.target_key} is outside the hub's prefix.`);
      if (opts.mode === "import" && (await storage.exists(img.target_key))) {
        problems.push(`storage: ${storage.bucket}/${img.target_key} already exists on the target.`);
      }
      imageUploads.push({ key: img.target_key, bytes: b.imageBytes.get(img.source_key)!, contentType: img.content_type });
    }
  }
  const rows = new Map<string, Row[]>();
  for (const [t, rs] of b.tables) rows.set(t, rs.map((r) => JSON.parse(rewrite(JSON.stringify(r))) as Row));

  // Restore: what is there now, and may it be cleared?
  const existing: Record<string, number> = {};
  if (opts.mode === "restore") {
    for (const t of b.manifest.tables) {
      if (!catalog.columns.has(t.table)) continue;
      const r = await client.query(`select count(*)::int as n from ${ident(t.table)} where hub_id = $1`, [hubId]);
      existing[t.table] = r.rows[0].n;
    }
    const blocked = APPEND_ONLY.filter((t) => (existing[t] ?? 0) > 0);
    if (blocked.length && !opts.clearAppendOnly) {
      problems.push(
        `Restore would clear append-only tables (${blocked.map((t) => `${t}: ${existing[t]} rows`).join(", ")}). ` +
          "Pass --clear-append-only to allow it.",
      );
    }
  }

  // Conflicts: every primary key and unique index, against rows outside the
  // hub (a restore clears the hub's own first; an import expects none).
  for (const [table, rs] of rows) {
    if (!rs.length) continue;
    for (const u of catalog.uniques.filter((x) => x.table === table)) {
      const cols = u.columns.map(ident).join(", ");
      const own = opts.mode === "restore" ? " and t.hub_id <> $2" : "";
      const r = await client.query(
        `select ${u.columns.map((c) => `t.${ident(c)}`).join(", ")} from ${ident(table)} t
          where (${u.columns.map((c) => `t.${ident(c)}`).join(", ")}) in
                (select ${cols} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb))${own}
          limit 5`,
        opts.mode === "restore" ? [JSON.stringify(rs), hubId] : [JSON.stringify(rs)],
      );
      for (const hit of r.rows) {
        problems.push(`${table}: ${u.columns.map((c) => `${c}=${String(hit[c])}`).join(", ")} already exists on the target.`);
      }
    }
  }
  if (problems.length) throw new ImportRefused("Nothing was changed.", problems);

  const isNullable = (t: string, c: string) => catalog.columns.get(t)?.get(c)?.nullable ?? false;
  const { order, deferred } = insertOrder([...rows.keys()], catalog.fks, isNullable);
  return { catalog, order, deferred, hubRow, rows, existing, imageUploads, targetNormalize };
}

// --- Apply -------------------------------------------------------------------

export interface ImportResult {
  counts: Record<string, number>;
  fingerprint: string;
  images: number;
  cleared: Record<string, number>;
}

const BATCH = 500;

async function insertRows(client: pg.Client, table: string, rows: Row[], cols: string[]): Promise<void> {
  const list = cols.map(ident).join(", ");
  for (let i = 0; i < rows.length; i += BATCH) {
    await client.query(
      `insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`,
      [JSON.stringify(rows.slice(i, i + BATCH))],
    );
  }
}

/** Set `cols` on existing rows from `rows`, matched on the table's primary key. */
async function setColumns(client: pg.Client, table: string, key: string[], rows: Row[], cols: string[]): Promise<void> {
  if (!cols.length) return;
  const set = cols.map((c) => `${ident(c)} = b.${ident(c)}`).join(", ");
  const on = key.map((k) => `t.${ident(k)} = b.${ident(k)}`).join(" and ");
  for (let i = 0; i < rows.length; i += BATCH) {
    await client.query(
      `update ${ident(table)} t set ${set} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb) b where ${on}`,
      [JSON.stringify(rows.slice(i, i + BATCH))],
    );
  }
}

async function checkForeignKeys(client: pg.Client, plan: ImportPlan, tables: Set<string>, hubId: string): Promise<void> {
  const broken: string[] = [];
  for (const fk of plan.catalog.fks.filter((f) => tables.has(f.table))) {
    const notNull = fk.columns.map((c) => `c.${ident(c)} is not null`).join(" and ");
    const match = fk.columns.map((c, i) => `p.${ident(fk.parentColumns[i])} = c.${ident(c)}`).join(" and ");
    const r = await client.query(
      `select count(*)::int as n from ${ident(fk.table)} c where c.hub_id = $1 and ${notNull}
         and not exists (select 1 from ${ident(fk.parent)} p where ${match})`,
      [hubId],
    );
    if (r.rows[0].n) broken.push(`${fk.table}(${fk.columns.join(", ")}) → ${fk.parent}: ${r.rows[0].n} rows point nowhere`);
  }
  if (broken.length) throw new ImportRefused("Foreign keys do not hold after loading; rolled back.", broken);
}

/**
 * Write the plan in one transaction and prove it before commit. Objects are
 * uploaded first (and removed again if the transaction fails, for an import).
 */
export async function applyImport(
  client: pg.Client,
  b: LoadedBundle,
  plan: ImportPlan,
  opts: ImportOptions,
): Promise<ImportResult> {
  const hubId = b.manifest.hub_id;
  const uploaded: string[] = [];
  if (opts.storage) {
    for (const u of plan.imageUploads) {
      await opts.storage.upload(u.key, u.bytes, u.contentType, opts.mode === "restore");
      uploaded.push(u.key);
    }
  }

  const cleared: Record<string, number> = {};
  try {
    await client.query("begin");

    if (opts.mode === "restore") {
      // Children before parents; break the same cycles by nulling first.
      for (const d of plan.deferred) {
        await client.query(
          `update ${ident(d.table)} set ${d.columns.map((c) => `${ident(c)} = null`).join(", ")} where hub_id = $1`,
          [hubId],
        );
      }
      for (const t of [...plan.order].reverse()) {
        const appendOnly = APPEND_ONLY.includes(t);
        if (appendOnly) await client.query("set local session_replication_role = replica");
        const r = await client.query(`delete from ${ident(t)} where hub_id = $1`, [hubId]);
        if (appendOnly) await client.query("set local session_replication_role = origin");
        cleared[t] = r.rowCount ?? 0;
      }
    } else {
      const cols = Object.keys(plan.hubRow);
      await insertRows(client, "hubs", [plan.hubRow], cols);
    }

    for (const t of plan.order) {
      const rs = plan.rows.get(t) ?? [];
      if (!rs.length) continue;
      const cols = b.manifest.tables.find((x) => x.table === t)!.columns;
      const d = plan.deferred.find((x) => x.table === t);
      const toInsert = d ? rs.map((r) => ({ ...r, ...Object.fromEntries(d.columns.map((c) => [c, null])) })) : rs;
      await insertRows(client, t, toInsert, cols);
    }

    // Exact values back where a BEFORE INSERT trigger rewrote them, and the
    // held-back cycle columns set — triggers suspended for these statements
    // only, then the foreign keys they could have skipped are checked.
    const fixed = new Set<string>();
    await client.query("set local session_replication_role = replica");
    for (const t of plan.order) {
      const rs = plan.rows.get(t) ?? [];
      if (!rs.length) continue;
      const key = plan.catalog.keys.get(t);
      if (!key) continue;
      const cols = b.manifest.tables.find((x) => x.table === t)!.columns.filter((c) => !key.includes(c));
      const d = plan.deferred.find((x) => x.table === t);
      if (plan.catalog.beforeInsertTriggers.has(t)) {
        // Keep derived columns the trigger computed (search_doc is not in the bundle).
        await setColumns(client, t, key, rs, cols);
        fixed.add(t);
      } else if (d) {
        await setColumns(client, t, key, rs, d.columns);
        fixed.add(t);
      }
    }
    await client.query("set local session_replication_role = origin");
    await checkForeignKeys(client, plan, fixed, hubId);

    // Prove it.
    const reader = pgRowReader(client);
    const counts: Record<string, number> = {};
    const readBack: Array<{ table: string; rows: Row[] }> = [];
    for (const t of b.manifest.tables) {
      const key = plan.catalog.keys.get(t.table) ?? t.columns.slice(0, 1);
      const rs = await reader.tableRows(t.table, hubId, key);
      counts[t.table] = rs.length;
      // Compare the columns the bundle carries: a newer target may add some.
      readBack.push({
        table: t.table,
        rows: rs.map((r) => Object.fromEntries(t.columns.map((c) => [c, r[c]]))),
      });
    }
    const mismatched = b.manifest.tables.filter((t) => counts[t.table] !== t.rows);
    const fingerprint = fingerprintTables(readBack, plan.targetNormalize);
    if (mismatched.length || fingerprint !== b.manifest.fingerprint) {
      throw new ImportRefused(
        "What was written does not match the bundle; rolled back.",
        [
          ...mismatched.map((t) => `${t.table}: ${counts[t.table]} rows written, bundle has ${t.rows}`),
          ...(fingerprint !== b.manifest.fingerprint ? ["content fingerprint differs"] : []),
        ],
      );
    }

    await client.query(
      "insert into control_audit_log (actor_email, action, target_hub_id, before, after) values ($1, $2, $3, $4, $5)",
      [
        opts.actor,
        opts.mode === "restore" ? "hub.restore" : "hub.import",
        hubId,
        opts.mode === "restore" ? JSON.stringify({ rows: plan.existing }) : null,
        JSON.stringify({
          bundle: b.name,
          exported_at: b.manifest.exported_at,
          exported_by: b.manifest.exported_by,
          fingerprint,
          rows: counts,
          images: plan.imageUploads.length,
          hostname: plan.hubRow.hostname,
          cleared_append_only: opts.mode === "restore" ? APPEND_ONLY.filter((t) => cleared[t]) : undefined,
        }),
      ],
    );
    await client.query("commit");
    return { counts, fingerprint, images: plan.imageUploads.length, cleared };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    if (opts.mode === "import" && opts.storage) await opts.storage.remove(uploaded).catch(() => undefined);
    throw err;
  }
}
