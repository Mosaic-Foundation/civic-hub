#!/usr/bin/env node
// Lays the Mosaic Space Kernel's files into this working tree, at the commit
// kernel.json pins (split trial, step 4; see docs/KERNEL-SPLIT.md).
//
// Runs before `npm ci` everywhere: on a laptop, in CI and in Vercel's install
// step. It needs only Node (no packages), because package.json itself comes
// from the kernel.
//
//   node scripts/kernel-sync.mjs           lay the pinned kernel down
//   node scripts/kernel-sync.mjs --check   fail if the tree differs from it
//
// Where the files come from:
//   KERNEL_DIR=/path/to/mosaic-kernel     a local clone (git archive of the pin)
//   otherwise                             the GitHub tarball of the pin
//
// The deployment slots in kernel.json are this repository's own files. The
// kernel's copies of them are skipped, so a slot is never overwritten.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(readFileSync(join(ROOT, "kernel.json"), "utf8"));
const STATE = join(ROOT, ".kernel");
const LIST = join(STATE, "files.txt");
const check = process.argv.includes("--check");

const owned = (path) =>
  pin.deploymentSlots.some((s) => (s.endsWith("/") ? path.startsWith(s) : path === s)) ||
  pin.kernelOnly.includes(path);

function fetchKernel() {
  const dir = mkdtempSync(join(tmpdir(), "mosaic-kernel-"));
  const tarball = join(dir, "kernel.tar.gz");
  const local = process.env.KERNEL_DIR;
  if (local) {
    execFileSync("git", ["-C", local, "archive", "--format=tar.gz", "-o", tarball, pin.commit]);
    execFileSync("tar", ["-xzf", tarball, "-C", dir]);
    rmSync(tarball);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const url = `https://codeload.github.com/${pin.repo}/tar.gz/${pin.commit}`;
  // curl is on every runner we use (GitHub Actions, Vercel, macOS).
  const args = ["-fsSL", "--retry", "3", "-o", tarball, url];
  if (process.env.KERNEL_TOKEN) args.unshift("-H", `Authorization: Bearer ${process.env.KERNEL_TOKEN}`);
  execFileSync("curl", args, { stdio: ["ignore", "inherit", "inherit"] });
  execFileSync("tar", ["-xzf", tarball, "-C", dir, "--strip-components=1"]);
  rmSync(tarball);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function walk(base, sub = "") {
  const out = [];
  for (const name of readdirSync(join(base, sub))) {
    const rel = sub ? `${sub}/${name}` : name;
    if (statSync(join(base, rel)).isDirectory()) out.push(...walk(base, rel));
    else out.push(rel);
  }
  return out;
}

const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const { dir, cleanup } = fetchKernel();
try {
  const files = walk(dir).filter((f) => !owned(f)).sort();
  const before = existsSync(LIST) ? readFileSync(LIST, "utf8").split("\n").filter(Boolean) : [];
  // A path that became a deployment slot is this repository's now: never removed.
  const stale = before.filter((f) => !files.includes(f) && !owned(f));

  if (check) {
    const wrong = files.filter((f) => !existsSync(join(ROOT, f)) || hash(join(ROOT, f)) !== hash(join(dir, f)));
    const leftover = stale.filter((f) => existsSync(join(ROOT, f)));
    if (wrong.length || leftover.length) {
      for (const f of wrong) console.error(`differs from the kernel at ${pin.commit.slice(0, 7)}: ${f}`);
      for (const f of leftover) console.error(`no longer in the kernel: ${f}`);
      console.error("Run: node scripts/kernel-sync.mjs");
      process.exit(1);
    }
    console.log(`kernel ${pin.commit.slice(0, 7)}: ${files.length} files match`);
  } else {
    for (const f of stale) rmSync(join(ROOT, f), { force: true });
    for (const f of files) {
      const to = join(ROOT, f);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(dir, f)));
      chmodSync(to, statSync(join(dir, f)).mode);
    }
    mkdirSync(STATE, { recursive: true });
    writeFileSync(LIST, files.join("\n") + "\n");
    writeFileSync(join(STATE, "commit"), pin.commit + "\n");
    console.log(`kernel ${pin.commit.slice(0, 7)}: ${files.length} files laid down in ${relative(process.cwd(), ROOT) || "."}`);
  }
} finally {
  cleanup();
}
