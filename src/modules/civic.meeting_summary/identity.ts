// Meeting identity — recognizing the same meeting across different connectors.
//
// WHY THIS EXISTS
// `source_id` is minted by whichever connector discovered a meeting, so it
// says as much about the discovery route as about the meeting. When a hub
// changes connectors, every id changes shape and the cron sees a database
// full of meetings it has never heard of — so it summarizes all of them
// again. Floyd hit exactly this migrating from HTML scraping to the Wix CMS:
//
//   old (HTML page):  https://www.floydcova.gov/_files/ugd/db2c48_1e9a….pdf
//   new (Wix CMS):    wix:2017Agenda:2026-06-09:regular-meeting
//
// The documents underneath did not change, and that is the durable identity.
// The same minutes PDF and the same recording mean the same meeting, whoever
// found it and whatever they chose to call it.
//
// URL FORMS ARE NOT STABLE; FILE IDENTITY IS
// Wix serves one file under several hostnames — `{site}/_files/ugd/{id}.pdf`
// and `https://{metaSiteId}.filesusr.com/ugd/{id}.pdf` are the same document,
// and a long-lived collection contains both. YouTube likewise has watch, live,
// and youtu.be forms. So we fingerprint the FILE or the VIDEO, not the URL.

/**
 * Stable identities for a meeting's source materials.
 *
 * Returns one opaque string per document or recording. Two meetings sharing
 * any fingerprint are the same meeting. Order is not meaningful and callers
 * should treat these as set members.
 */
export function sourceFingerprints(sources: {
  source_minutes_url?: string | null;
  source_agenda_url?: string | null;
  source_video_url?: string | null;
  additional_video_urls?: string[] | null;
}): string[] {
  const out = new Set<string>();

  for (const url of [sources.source_minutes_url, sources.source_agenda_url]) {
    const fp = documentFingerprint(url);
    if (fp) out.add(fp);
  }

  const videos = [
    sources.source_video_url,
    ...(sources.additional_video_urls ?? []),
  ];
  for (const url of videos) {
    const fp = videoFingerprint(url);
    if (fp) out.add(fp);
  }

  return [...out];
}

/**
 * Identify a document by its storage id rather than the host serving it.
 *
 * Wix stores files under `/ugd/{bucket}_{hash}.pdf`, and that path is the
 * same whichever hostname (or `wix:document://` reference) points at it.
 * Anything else falls back to the normalized full URL, which is still correct
 * — just less tolerant of a host change.
 */
export function documentFingerprint(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;

  const ugd = raw.match(/\/?ugd\/([A-Za-z0-9_-]+\.pdf)/i);
  if (ugd) return `doc:ugd/${ugd[1].toLowerCase()}`;

  try {
    const u = new URL(raw);
    return `doc:${u.host.toLowerCase()}${u.pathname.toLowerCase()}`;
  } catch {
    return `doc:${raw.toLowerCase()}`;
  }
}

/**
 * Identify a recording by its video id, across watch / live / youtu.be forms.
 * Non-YouTube URLs fall back to host + path.
 */
export function videoFingerprint(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase().replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return `yt:${v}`;
      // /live/{id} and /embed/{id}
      const seg = u.pathname.split("/").filter(Boolean);
      const last = seg[seg.length - 1] ?? "";
      if (/^[A-Za-z0-9_-]{11}$/.test(last)) return `yt:${last}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `yt:${id}`;
    }
    return `vid:${host}${u.pathname.toLowerCase()}`;
  } catch {
    return `vid:${raw.toLowerCase()}`;
  }
}
