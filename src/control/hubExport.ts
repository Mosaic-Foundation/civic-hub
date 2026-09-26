// "Export this hub" in the console: the same bundle scripts/export-hub.ts
// writes, packed as .tar.gz, left in the private hub-exports bucket, and
// handed to the operator as a ten-minute signed link. The caller (./router.ts)
// requires a fresh code first and records the export in the audit log.

import { bundleName, exportHub, memorySink } from "./hubBundle/export.js";
import { supabaseObjectReader, supabaseRowReader } from "./hubBundle/supabaseReader.js";
import { packTarGz } from "./hubBundle/tar.js";
import { signHubExport, storeHubExport } from "../db/hubExportsBucket.js";
import { postImageBucket } from "../services/postImageStorage.js";
import { deploymentCommit } from "../config/deployment.js";

export interface HubExportResult {
  object_key: string;
  file_name: string;
  size: number;
  url: string;
  expires_at: string;
  fingerprint: string;
  rows: number;
  images: number;
  format_version: number;
}

export async function exportHubArchive(hubId: string, actor: string): Promise<HubExportResult> {
  const now = new Date();
  const name = bundleName(hubId, now);
  const sink = memorySink();
  const manifest = await exportHub({
    hubId,
    rows: supabaseRowReader(),
    objects: supabaseObjectReader(postImageBucket()),
    bucket: postImageBucket(),
    sink,
    exportedBy: `console:${actor}`,
    commit: deploymentCommit() === "unknown" ? null : deploymentCommit().slice(0, 7),
    now,
  });
  const archive = packTarGz([...sink.files].map(([path, data]) => ({ path: `${name}/${path}`, data })), now.getTime());
  const fileName = `${name}.tar.gz`;
  const key = await storeHubExport(hubId, fileName, archive);
  const link = await signHubExport(key, fileName);
  return {
    object_key: key,
    file_name: fileName,
    size: archive.length,
    url: link.url,
    expires_at: link.expires_at,
    fingerprint: manifest.fingerprint,
    rows: manifest.tables.reduce((n, t) => n + t.rows, 0),
    images: manifest.images.count,
    format_version: manifest.format_version,
  };
}
