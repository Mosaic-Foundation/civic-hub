// What Announcements puts on the hub's Pinned card (PluginServer.pinnedCard;
// pinning phase 2, Adam, 2026-11-18). Pinning is the hub's; this plugin writes
// no pin code. It offers:
//
//   first   every announcement marked urgent right now (./board.ts), newest
//           first: the card lists them above the pins, and the first is the
//           red line across the top of the hub's pages.
//   fill    the newest few announcements, for a card nothing is pinned to.
//
// A removed announcement is on neither.

import { processesOf, type PinnedCardItem, type PluginPinnedCard, type Process } from "@civic-social/plugin-sdk";
import { isUrgentNow } from "./board.js";
import type { AnnouncementProcessState } from "./models.js";

/** How many announcements fill an empty card. */
const FILL = 3;

const announcements = () => processesOf("civic.announcement");

function item(p: Process, samples: Set<string>): PinnedCardItem & { state: AnnouncementProcessState } {
  const state = p.state as unknown as AnnouncementProcessState;
  return {
    process_id: p.id,
    title: state.content?.title || p.title,
    published_at: state.created_at ?? p.createdAt,
    url: `/announcement/${p.id}`,
    ...(samples.has(p.id) && !p.addedInDemo ? { sample: true as const } : {}),
    state,
  };
}

/** How many of the newest to read for `fill`: a few spare, as a removed one is left out after the read. */
const FILL_READ = FILL * 3;

async function rows(read: Promise<Process[]>): Promise<Array<PinnedCardItem & { state: AnnouncementProcessState }>> {
  const [found, samples] = await Promise.all([read, announcements().sampleIds()]);
  return found
    .map((p) => item(p, samples))
    .filter((i) => !i.state.moderation?.removed)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
}

function bare({ state: _state, ...rest }: PinnedCardItem & { state: AnnouncementProcessState }): PinnedCardItem {
  return rest;
}

export const pinnedCard: PluginPinnedCard = {
  async first() {
    const now = Date.now();
    // Only the ones marked urgent are read; few, as each has an end date at most 30 days out.
    return (await rows(announcements().list({ where: { urgent: "true" }, limit: 100 })))
      .filter((i) => isUrgentNow(i.state, now))
      .map((i) => ({ ...bare(i), urgent: true as const, until: i.state.urgent_until ?? null }));
  },
  async fill() {
    return (await rows(announcements().list({ limit: FILL_READ }))).slice(0, FILL).map(bare);
  },
};
