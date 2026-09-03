// Vercel serverless function — serves page-specific Open Graph meta
// tags for social media crawlers. Normal browser requests get the SPA
// index.html unchanged.
//
// vercel.json routes every public detail section (/process/:id,
// /proposal/:id, /brief/:id, etc.) here. The function checks User-Agent:
// crawlers get a minimal HTML page with the right og:title /
// og:description / og:image, resolved by the hub's registry-driven
// GET /share/meta; browsers get the built SPA so React Router handles
// client-side routing.

import type { IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { resolve } from "path";

const CRAWLER_RE =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|WhatsApp|Discordbot|TelegramBot|Applebot|Pinterest|Embedly|Quora|vkShare|W3C_Validator/i;

const HUB_NAME =
  process.env.VITE_HUB_PAGE_TITLE ?? "Floyd County, VA — Civic Hub";
const BANNER_URL =
  process.env.VITE_HUB_BANNER_URL ?? "/floyd-banner.jpg";
const SITE_URL = (
  process.env.CIVIC_UI_BASE_URL ??
  process.env.BASE_URL ??
  "https://floyd.civic.social"
).replace(/\/$/, "");

let cachedIndexHtml: string | null = null;

function getIndexHtml(): string | null {
  if (cachedIndexHtml) return cachedIndexHtml;
  // Vercel's outputDirectory is ui/dist — the serverless function runs
  // from .vercel/output/functions/api/og.func/ but static assets are
  // at the deployment root. Try several candidate paths that cover
  // local dev and Vercel's production layout.
  const candidates = [
    resolve("/var/task", "ui", "dist", "index.html"),
    resolve("/var/task/user", "ui", "dist", "index.html"),
    resolve("/vercel/path0", "ui", "dist", "index.html"),
    "/var/task/ui/dist/index.html",
    "/var/task/index.html",
  ];
  for (const p of candidates) {
    try {
      cachedIndexHtml = readFileSync(p, "utf-8");
      return cachedIndexHtml;
    } catch {
      // try next
    }
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absoluteImage(img: string | undefined | null): string {
  if (!img) return `${SITE_URL}${BANNER_URL}`;
  if (img.startsWith("http")) return img;
  return `${SITE_URL}${img}`;
}

interface OgData {
  title: string;
  description: string;
  image?: string | null;
}

/**
 * One call for every page kind. The hub's GET /share/meta resolves the id
 * through the process registry (services/shareMeta.ts), so this function
 * never enumerates sections — a type added later is covered the moment its
 * handler has a detailPath and vercel.json routes that section here
 * (tests/unit/shareMeta.test.ts guards that list).
 */
async function fetchOgData(pathname: string): Promise<OgData | null> {
  try {
    // `page`, not `path`: Vercel's /api/:path* rewrite appends its own
    // `path=` capture to the query and would clobber ours.
    const res = await fetch(
      `${SITE_URL}/api/share/meta?page=${encodeURIComponent(pathname)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<OgData>;
    if (!data.title) return null;
    return {
      title: data.title,
      description: data.description ?? data.title,
      image: data.image ?? null,
    };
  } catch {
    return null;
  }
}

function ogHtml(og: OgData, pathname: string): string {
  const url = `${SITE_URL}${pathname}`;
  const image = absoluteImage(og.image);
  const t = escapeHtml(og.title);
  const d = escapeHtml(og.description);
  const hubName = escapeHtml(HUB_NAME);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${t} — ${hubName}</title>
  <meta name="description" content="${d}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:site_name" content="${hubName}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
</head>
<body>
  <h1>${t}</h1>
  <p>${d}</p>
  <p><a href="${escapeHtml(url)}">Open in ${hubName}</a></p>
</body>
</html>`;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const ua = req.headers["user-agent"] ?? "";
  // Vercel's rewrite appends its `:id` capture as a query string; the
  // canonical og:url must be the bare path.
  const pathname = (req.url ?? "/").split("?")[0];

  if (CRAWLER_RE.test(ua)) {
    const og = await fetchOgData(pathname);
    if (og) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ogHtml(og, pathname));
      return;
    }
  }

  // Not a crawler (or data fetch failed) — serve the SPA.
  const html = getIndexHtml();
  if (html) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } else {
    // index.html not found on disk — fetch it from the CDN. The
    // file is served by Vercel's static layer at /index.html (the
    // catch-all rewrite). We fetch it once and cache for subsequent
    // requests to avoid repeated round-trips.
    try {
      const cdnRes = await fetch(`${SITE_URL}/index.html`);
      if (cdnRes.ok) {
        cachedIndexHtml = await cdnRes.text();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(cachedIndexHtml);
      } else {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Could not load application.");
      }
    } catch {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Could not load application.");
    }
  }
}
