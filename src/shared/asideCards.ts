// The right column's cards (layout session, 2026-11-07; ADR-019): which are
// shown, and in what order. One hub setting, `nav.aside_cards`, a JSON list of
// { id, shown } in order; unset is every card the hub knows, shown, in the
// default order. Read by the hub's three-column layout and its editor in
// Hub settings → Appearance → Right column.
//
// A card id the stored list names but this hub does not draw (a plugin's card
// once plugins can add them, its plugin off) is kept in the list and skipped
// when drawn, so switching the plugin back on brings it back where it was. A
// card the list does not name is drawn after the listed ones, shown, in the
// default order. Pure, so the rules are tested without a browser
// (tests/unit/asideCards.test.ts).

/** The hub's own cards, in their default order. */
export const ASIDE_CARD_IDS = ["coming_up", "announcements", "about"] as const;
export type HubAsideCardId = (typeof ASIDE_CARD_IDS)[number];

export interface AsideCardSetting {
  id: string;
  shown: boolean;
}

/** An id a card may have: lower case, digits, `_` and `-`, starting with a letter. */
export const ASIDE_CARD_ID_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;

/** At most this many entries in the stored list. */
export const ASIDE_CARDS_MAX = 20;

/** A stored `nav.aside_cards` as a list; anything unreadable is the default (an empty list). */
export function parseAsideCards(value: string | undefined | null): AsideCardSetting[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AsideCardSetting[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { id, shown } = entry as { id?: unknown; shown?: unknown };
      if (typeof id !== "string" || out.some((e) => e.id === id)) continue;
      out.push({ id, shown: shown !== false });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Every card this hub draws (`available`, in its default order), in the
 * stored order, each with whether it is shown. Listed ids the hub doesn't
 * draw are left out here, and kept by `withOrder`.
 */
export function orderedAsideCards(stored: readonly AsideCardSetting[], available: readonly string[]): AsideCardSetting[] {
  const listed = stored.filter((e) => available.includes(e.id));
  const rest = available.filter((id) => !stored.some((e) => e.id === id)).map((id) => ({ id, shown: true }));
  return [...listed, ...rest];
}

/**
 * The list to store after the editor's change to the cards this hub draws:
 * those in their new order, then any listed card it does not draw, kept as
 * they were.
 */
export function withOrder(stored: readonly AsideCardSetting[], drawn: readonly AsideCardSetting[]): AsideCardSetting[] {
  const kept = stored.filter((e) => !drawn.some((d) => d.id === e.id));
  return [...drawn.map((d) => ({ id: d.id, shown: d.shown })), ...kept];
}
