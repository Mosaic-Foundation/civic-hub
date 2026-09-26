// A bundle's archive form: a gzip'd POSIX tar (ustar) of the same tree the
// directory form has. Written here rather than pulled in as a dependency —
// the format is 512-byte headers and padded bodies, and a bundle holds only
// regular files. The reader accepts what the writer writes plus what `tar`
// on macOS and Linux write for such a tree (directories, pax headers are
// skipped), so an operator can unpack a bundle, look, and pack it again.

import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;

export interface TarEntry {
  path: string;
  data: Buffer;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(path: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) {
      throw new Error(`tar: path too long for ustar: ${path}`);
    }
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write("0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148, 8, "ascii");
  return h;
}

/** Pack entries into a .tar.gz. */
export function packTarGz(entries: TarEntry[], mtime: number = Date.now()): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.path, e.data.length, mtime), e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(parts));
}

function field(buf: Buffer, start: number, len: number): string {
  const raw = buf.subarray(start, start + len);
  const nul = raw.indexOf(0);
  return (nul >= 0 ? raw.subarray(0, nul) : raw).toString("utf8");
}

/** Unpack a .tar.gz into its regular files. */
export function unpackTarGz(archive: Buffer): TarEntry[] {
  const tar = gunzipSync(archive);
  const out: TarEntry[] = [];
  let off = 0;
  let paxPath: string | null = null;
  while (off + BLOCK <= tar.length) {
    const h = tar.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = field(h, 156, 1) || "0";
    const name = field(h, 0, 100);
    const prefix = field(h, 257, 6).startsWith("ustar") ? field(h, 345, 155) : "";
    const body = tar.subarray(off + BLOCK, off + BLOCK + size);
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      // pax extended header: honour `path`, ignore the rest.
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type !== "0" && type !== "\0") {
      paxPath = null;
      continue; // directories, global pax headers, links: not bundle content
    }
    const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    out.push({ path: path.replace(/^\.\//, ""), data: Buffer.from(body) });
  }
  return out;
}
