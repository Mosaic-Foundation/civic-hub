import type { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import { buildShareMeta, parseDetailPath } from "../services/shareMeta.js";

/**
 * GET /share/meta?path=/brief/proc_x — public. The preview a crawler should
 * see for that page, or 404 when the page is not shareable. Consumed by the
 * Vercel OG function; nothing here is per-type.
 */
export async function handleGetShareMeta(req: Request, res: Response): Promise<void> {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  const parsed = parseDetailPath(path);
  if (!parsed) {
    res.status(400).json({ error: "path must look like /section/id" });
    return;
  }
  try {
    const process = await getProcess(parsed.id);
    const meta = process ? buildShareMeta(path, process) : null;
    if (!meta) {
      res.status(404).json({ error: "Not shareable" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
}
