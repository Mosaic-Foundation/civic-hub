// The right column's cards, one registry (ADR-019): what the three-column
// layout draws and what Hub settings → Appearance → Right column lists. The
// column draws them in the hub's order (`nav.aside_cards`,
// src/shared/asideCards.ts), each one shown, and a card with nothing to say
// draws nothing.
//
// The hub's own three are here. A plugin's card would join this list from its
// package's UI module, under its plugin's switch; that side is written up in
// ADR-019 and not built (Adam, 2026-11-07).

import type { ComponentType } from "react";
import { ASIDE_CARD_IDS, orderedAsideCards, parseAsideCards, type AsideCardSetting } from "../../../src/shared/asideCards";
import { setting } from "../config/hubConfig";
import { AboutCard, AnnouncementsCard, ComingUpCard } from "./cards";
import type { AsideData } from "./useAsideData";

export interface AsideCardUi {
  id: string;
  /** Its name in the Right column editor. */
  name: string;
  /** What it shows, under its name in the editor. */
  about: string;
  Component: ComponentType<{ data: AsideData }>;
}

const HUB_CARDS: Record<(typeof ASIDE_CARD_IDS)[number], AsideCardUi> = {
  coming_up: {
    id: "coming_up",
    name: "Coming up",
    about: "The next events and closing dates, with a link to the whole calendar.",
    Component: ComingUpCard,
  },
  announcements: {
    id: "announcements",
    name: "Announcements",
    about: "The latest announcements.",
    Component: AnnouncementsCard,
  },
  about: {
    id: "about",
    name: "About",
    about: "The hub, its member count and a way to join.",
    Component: AboutCard,
  },
};

/** Every card this hub draws, in the default order. */
export function asideCardRegistry(): AsideCardUi[] {
  return ASIDE_CARD_IDS.map((id) => HUB_CARDS[id]);
}

export const ASIDE_SETTING_KEY = "nav.aside_cards";

/** Every card in the hub's order, each with whether it is shown; `stored` defaults to the hub's setting. */
export function asideCardsInOrder(stored?: string): Array<AsideCardSetting & { card: AsideCardUi }> {
  const cards = asideCardRegistry();
  const list = orderedAsideCards(parseAsideCards(stored ?? setting(ASIDE_SETTING_KEY)), cards.map((c) => c.id));
  return list.map((e) => ({ ...e, card: cards.find((c) => c.id === e.id)! }));
}
