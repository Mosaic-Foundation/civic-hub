// What the plugins put on the Pinned card (PluginServer.pinnedCard; pinning
// phase 2, src/plugins/pinnedCard.ts): each loaded package's whose plugin is
// on, in the configured order. One plugin's failure leaves its rows out and is
// reported; the card still shows the rest.

import { loadedPackages } from "../plugins/loader.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { reportError } from "../utils/reportError.js";
import type { PinnedCardItem, PluginPinnedCard } from "../plugins/pinnedCard.js";

async function collect(read: (card: PluginPinnedCard) => Promise<PinnedCardItem[]>): Promise<PinnedCardItem[]> {
  const cards = loadedPackages().flatMap((p) => (p.server.pinnedCard && isProcessTypeEnabled(p.type) ? [{ p, card: p.server.pinnedCard }] : []));
  const lists = await Promise.all(
    cards.map(async ({ p, card }) => {
      try {
        return (await read(card)) ?? [];
      } catch (err) {
        reportError("pinned_card_failed", err instanceof Error ? err.message : String(err), { package: p.pkg.name }, err);
        return [];
      }
    }),
  );
  return lists.flat();
}

/** The plugins' items for the top of the card, right now. */
export function contributedFirst(): Promise<PinnedCardItem[]> {
  return collect(async (card) => (card.first ? card.first() : []));
}

/**
 * The word a pinned item shows for its type: its plugin's own (`label`), else
 * null for the type's label. A plugin's failure reads as null and is reported.
 */
export function pinnedItemLabel(type: string, item: { process_id: string; state: Record<string, unknown> }): string | null {
  for (const p of loadedPackages()) {
    if (p.type !== type || !p.server.pinnedCard?.label) continue;
    try {
      return p.server.pinnedCard.label(item)?.trim() || null;
    } catch (err) {
      reportError("pinned_card_failed", err instanceof Error ? err.message : String(err), { package: p.pkg.name }, err);
      return null;
    }
  }
  return null;
}

/**
 * The items the first plugin with any offers to fill an otherwise empty card,
 * and that plugin's process type (the card is named after it: "Announcements").
 */
export async function contributedFill(isAdmin: boolean): Promise<{ type: string; items: PinnedCardItem[] } | null> {
  for (const p of loadedPackages()) {
    const card = p.server.pinnedCard;
    if (!card?.fill || !isProcessTypeEnabled(p.type)) continue;
    try {
      const items = await card.fill({ isAdmin });
      if (items.length > 0) return { type: p.type, items };
    } catch (err) {
      reportError("pinned_card_failed", err instanceof Error ? err.message : String(err), { package: p.pkg.name }, err);
    }
  }
  return null;
}
