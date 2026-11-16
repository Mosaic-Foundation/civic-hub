// GET /admin/news-sync/items (2026-11-16): for each post News Sync copied in,
// who it is from and whether it shows as News or as an announcement
// (src/shared/newsSource.ts). Admin → Announcements reads it to tag its rows
// and to offer a Source filter. News Sync's own route, so the Announcements
// plugin knows nothing about it: with News Sync off it answers an empty list.

import { route } from "../http/route.js";
import { getAllProcesses } from "../services/processService.js";
import { getSettingSync, isPluginEnabledSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import { syncedFrom, syncedSourceView, type NewsShowAs } from "../shared/newsSource.js";

export interface NewsSyncItem {
  id: string;
  /** Who it is from: the hub's From label as set now, else the post's own label, else its author label. */
  from: string;
  show_as: NewsShowAs;
}

export const handleAdminListNewsSyncItems = route(async (_req, res) => {
  if (!isPluginEnabledSync("news_sync")) {
    res.json({ items: [] });
    return;
  }
  const all = await getAllProcesses(["civic.announcement"]);
  // Each hub has one News Sync source, so the From label as it stands now
  // names every synced post, including ones copied in before it changed.
  const current = getSettingSync(KEYS.PLUGIN_NEWS_SYNC_FROM_LABEL);
  const items: NewsSyncItem[] = [];
  for (const p of all) {
    const state = p.state as { source?: unknown; author_role?: unknown };
    const view = syncedSourceView(state.source);
    if (!view) continue;
    const role = typeof state.author_role === "string" && state.author_role.trim() ? state.author_role.trim() : "News Sync";
    items.push({ id: p.id, from: syncedFrom(current, view.label ?? role), show_as: view.showAs });
  }
  res.json({ items });
});
