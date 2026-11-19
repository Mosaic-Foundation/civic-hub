// The right column's cards, one registry (ADR-019): what the three-column
// layout draws and what Hub settings → Appearance → Right column lists. The
// column draws them in the space's order (`nav.aside_cards`,
// src/shared/asideCards.ts), each one shown, and a card with nothing to say
// draws nothing.
//
// The kernel's own two are here (Coming up, About). A feature plugin adds its
// cards from its UI module (ui/src/features.ts `asideCards`), under its
// switch: Pinning's Pinned card (kernel step 4). Each card's `order` places
// it in the default order.

import type { ComponentType } from "react";
import { orderedAsideCards, parseAsideCards, type AsideCardSetting } from "../../../src/shared/asideCards";
import { setting } from "../config/hubConfig";
import { pluginEnabled } from "../config/plugins";
import { FEATURE_UI } from "../features";
import { AboutCard, ComingUpCard } from "./cards";
import type { AsideData } from "./useAsideData";

export interface AsideCardUi {
  id: string;
  /** Its name in the Right column editor. */
  name: string;
  /** What it shows, under its name in the editor. */
  about: string;
  /** Its place in the default order: Coming up is 10, About 90. */
  order: number;
  Component: ComponentType<{ data: AsideData }>;
}

const KERNEL_CARDS: readonly AsideCardUi[] = [
  {
    id: "coming_up",
    name: "Coming up",
    about: "The next events and closing dates, with a link to the whole calendar.",
    order: 10,
    Component: ComingUpCard,
  },
  {
    id: "about",
    name: "About",
    about: "The space, its member count and a way to join.",
    order: 90,
    Component: AboutCard,
  },
];

/** Every card this space draws (the kernel's, and those of the features that are on), in the default order. */
export function asideCardRegistry(): AsideCardUi[] {
  const features = FEATURE_UI.flatMap((u) => (u.asideCards && pluginEnabled(u.feature) ? u.asideCards : []));
  return [...KERNEL_CARDS, ...features].sort((a, b) => a.order - b.order);
}

export const ASIDE_SETTING_KEY = "nav.aside_cards";

/** Every card in the space's order, each with whether it is shown; `stored` defaults to the space's setting. */
export function asideCardsInOrder(stored?: string): Array<AsideCardSetting & { card: AsideCardUi }> {
  const cards = asideCardRegistry();
  const list = orderedAsideCards(parseAsideCards(stored ?? setting(ASIDE_SETTING_KEY)), cards.map((c) => c.id));
  return list.map((e) => ({ ...e, card: cards.find((c) => c.id === e.id)! }));
}
