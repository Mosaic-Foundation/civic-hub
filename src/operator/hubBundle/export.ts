// Export one hub as a bundle (./format.ts). The walk is the export manifest
// (src/db/schemaContract.ts → EXPORT_MANIFEST): every table marked `export`,
// filtered to the hub, in key order; the hub's `hubs` row; every stored
// object the hub owns. Readers are passed in, so the same walk serves the
// console (service-role Supabase, ./supabaseReader.ts), the script, and a
// scratch database restored from a full dump (scripts/lib/pgHub.ts).

import { MIGRATION_DEFAULT_HUB_ID } from "../../models/hub.js";
import type { SampleIds } from "../../models/sampleContent.js";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  EXCLUDED_COLUMNS,
  TABLE_KEYS,
  exportedTables,
  fingerprintTables,
  imageFile,
  imageOwner,
  imageUrlNormalizer,
  isExcludedColumn,
  isSampleContentRow,
  isSecretSettingKey,
  omittedTables,
  publicObjectPrefix,
  renderReadme,
  sha256,
  tableFile,
  targetImageKey,
  toJsonl,
  type BundleImage,
  type BundleManifest,
  type BundleTable,
  type Row,
} from "./format.js";

export interface HubRowReader {
  kind: "supabase" | "postgres";
  /** The hub's `hubs` row, or null. */
  hubRow(hubId: string): Promise<Row | null>;
  /** Every row of `table` with this hub_id, ordered by `key`. */
  tableRows(table: string, hubId: string, key: readonly string[]): Promise<Row[]>;
}

export interface ObjectReader {
  /** The storage host stored URLs point at (the project URL). */
  storageBaseUrl: string;
  bucket: string;
  /** Every object key under `prefix` (which ends in `/`), recursively. */
  listKeys(prefix: string): Promise<string[]>;
  /** The names at the top of the bucket (folders and files). */
  listTop(): Promise<string[]>;
  download(key: string): Promise<{ bytes: Buffer; contentType: string }>;
}

export interface BundleSink {
  write(path: string, data: Buffer): Promise<void>;
}

export interface ExportOptions {
  hubId: string;
  rows: HubRowReader;
  /** Null when storage cannot be read; `objectsMissingReason` then says why. */
  objects: ObjectReader | null;
  objectsMissingReason?: string;
  bucket: string;
  sink: BundleSink;
  exportedBy: string;
  commit?: string | null;
  now?: Date;
}

export class ExportError extends Error {}

/** `civic-hub-export-<hub>-<YYYYMMDDTHHMMSSZ>`: the bundle's directory name. */
export function bundleName(hubId: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `civic-hub-export-${hubId}-${stamp}`;
}

/** Every key the hub owns in the bucket, by the ownership rule. */
export async function ownedObjectKeys(objects: ObjectReader, hubId: string): Promise<string[]> {
  const prefixes = [`${hubId}/`, `hubs/${hubId}/`];
  if (hubId === MIGRATION_DEFAULT_HUB_ID) {
    for (const top of await objects.listTop()) if (/^\d{4}$/.test(top)) prefixes.push(`${top}/`);
  }
  const keys = new Set<string>();
  for (const p of prefixes) for (const k of await objects.listKeys(p)) keys.add(k);
  return [...keys].filter((k) => imageOwner(k, MIGRATION_DEFAULT_HUB_ID)?.owner === hubId).sort();
}

export async function exportHub(opts: ExportOptions): Promise<BundleManifest> {
  const { hubId, rows: reader, sink } = opts;
  const now = opts.now ?? new Date();

  const hub = await reader.hubRow(hubId);
  if (!hub) throw new ExportError(`No hub "${hubId}" in this database.`);

  // Tables.
  const tables: BundleTable[] = [];
  const kept: Array<{ table: string; rows: Row[] }> = [];
  const excludedSettings: Array<{ key: string; reason: string }> = [];
  // Sample content stays behind. Child rows are known only by their process,
  // so the marked tables are read first and kept for their own turn.
  const prefetched = new Map<string, Row[]>();
  for (const table of ["processes", "users", "process_reviews"]) {
    prefetched.set(table, await reader.tableRows(table, hubId, TABLE_KEYS[table]));
  }
  const processIds = new Set(prefetched.get("processes")!.filter((r) => r.is_sample === true).map((r) => String(r.id)));
  const sampleIds: SampleIds = {
    processIds,
    userIds: new Set(prefetched.get("users")!.filter((r) => r.is_sample === true).map((r) => String(r.id))),
    // A visitor's demo submission has a review; its turns stay behind with it.
    reviewIds: new Set(
      prefetched
        .get("process_reviews")!
        .filter((r) => processIds.has(String(r.process_id)))
        .map((r) => String(r.id)),
    ),
  };
  for (const table of exportedTables()) {
    const key = TABLE_KEYS[table];
    if (!key) throw new ExportError(`No key order for exported table "${table}" (format.ts → TABLE_KEYS).`);
    const all = prefetched.get(table) ?? (await reader.tableRows(table, hubId, key));
    let skippedSample = 0;
    const out: Row[] = [];
    for (const raw of all) {
      if (isSampleContentRow(table, raw, sampleIds)) {
        skippedSample++;
        continue;
      }
      if (table === "hub_settings" && isSecretSettingKey(String(raw.key))) {
        excludedSettings.push({ key: String(raw.key), reason: "a secret by its name; the value never leaves" });
        continue;
      }
      const row: Row = {};
      for (const [k, v] of Object.entries(raw)) if (!isExcludedColumn(table, k)) row[k] = v;
      out.push(row);
    }
    const body = Buffer.from(toJsonl(out));
    await sink.write(tableFile(table), body);
    const columns = [...new Set(out.flatMap((r) => Object.keys(r)))].sort();
    tables.push({
      table,
      file: tableFile(table),
      rows: out.length,
      columns,
      sha256: sha256(body),
      skipped_sample_rows: skippedSample,
    });
    kept.push({ table, rows: out });
  }

  // Images.
  const images: BundleImage[] = [];
  let bytes = 0;
  if (opts.objects) {
    for (const key of await ownedObjectKeys(opts.objects, hubId)) {
      const own = imageOwner(key, MIGRATION_DEFAULT_HUB_ID)!;
      const { bytes: data, contentType } = await opts.objects.download(key);
      await sink.write(imageFile(key), data);
      bytes += data.length;
      images.push({
        source_key: key,
        target_key: targetImageKey(key, hubId, own.rule),
        file: imageFile(key),
        owner: own.owner,
        rule: own.rule,
        content_type: contentType,
        size: data.length,
        sha256: sha256(data),
      });
    }
  }
  await sink.write("images.json", Buffer.from(JSON.stringify(images, null, 2) + "\n"));

  const storageBaseUrl = opts.objects?.storageBaseUrl ?? null;
  const normalize = storageBaseUrl
    ? imageUrlNormalizer(
        images.map((i) => ({
          url: publicObjectPrefix(storageBaseUrl, opts.bucket) + i.source_key,
          sourceKey: i.source_key,
        })),
      )
    : undefined;

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    format_version: BUNDLE_FORMAT_VERSION,
    exported_at: now.toISOString(),
    exported_by: opts.exportedBy,
    source: {
      kind: reader.kind,
      storage_base_url: storageBaseUrl,
      bucket: opts.bucket,
      commit: opts.commit ?? null,
    },
    hub_id: hubId,
    tables,
    omitted_tables: omittedTables(),
    excluded_columns: [...EXCLUDED_COLUMNS],
    excluded_settings: excludedSettings,
    images: {
      file: "images.json",
      count: images.length,
      bytes,
      not_included_reason: opts.objects ? null : (opts.objectsMissingReason ?? "storage was not readable"),
    },
    fingerprint: fingerprintTables(kept, normalize),
  };

  await sink.write("hub.json", Buffer.from(JSON.stringify(hub, null, 2) + "\n"));
  await sink.write("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  await sink.write("README.md", Buffer.from(renderReadme(manifest, hub)));
  return manifest;
}

/** A sink that keeps the files in memory (the console packs them into a .tar.gz). */
export function memorySink(): BundleSink & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async write(path, data) {
      files.set(path, data);
    },
  };
}
