import type { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import { buildShareMeta, parseDetailPath } from "../services/shareMeta.js";

/**
 * GET /share/meta?page=/brief/proc_x — public. The preview a crawler should
 * see for that page, or 404 when the page is not shareable. Consumed by the
 * Vercel OG function; nothing here is per-type.
 *
 * The parameter is `page`, NOT `path`: vercel.json rewrites `/api/:path*`
 * to the function and Vercel appends its own `path=share/meta` capture to
 * the query, which silently replaced ours on prod (every page 404'd as
 * "Not shareable" while dev was fine). `pagePath` also tolerates a repeated
 * parameter by taking the first value that looks like a page path.
 */
export function pagePath(query: Request["query"]): string {
  const raw = query.page;
  const values = Array.isArray(raw) ? raw : [raw];
  for (const v of values) {
    if (typeof v === "string" && v.startsWith("/")) return v;
  }
  return "";
}

export async function handleGetShareMeta(req: Request, res: Response): Promise<void> {
  const path = pagePath(req.query);
  const parsed = parseDetailPath(path);
  if (!parsed) {
    res.status(400).json({ error: "page must look like /section/id" });
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
