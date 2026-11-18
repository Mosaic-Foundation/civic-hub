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

async function live(): Promise<Array<PinnedCardItem & { state: AnnouncementProcessState }>> {
  const [all, samples] = await Promise.all([announcements().list(), announcements().sampleIds()]);
  return all
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
    return (await live())
      .filter((i) => isUrgentNow(i.state, now))
      .map((i) => ({ ...bare(i), urgent: true as const, until: i.state.urgent_until ?? null }));
  },
  async fill() {
    return (await live()).slice(0, FILL).map(bare);
  },
};
