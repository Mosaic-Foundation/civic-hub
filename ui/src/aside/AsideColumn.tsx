// The three-column layout's right column (ADR-019): the hub's cards in its
// order, the shown ones only: a column of its own, sticky beside the feed,
// from 1280px; narrower it is not drawn (App.tsx). Its data is read once
// (useAsideData).

import { useHub } from "../config/hub";
import { asideCardsInOrder } from "./registry";
import { useAsideData } from "./useAsideData";
import "./aside.css";

export default function AsideColumn() {
  // Re-read on a Settings save: the order and the switches are hub settings.
  useHub();
  const data = useAsideData();
  if (!data.loaded) return <aside className="app-aside" aria-label="More from this hub" aria-busy="true" />;
  const shown = asideCardsInOrder().filter((e) => e.shown);
  return (
    <aside className="app-aside" aria-label="More from this hub">
      {shown.map(({ card }) => (
        <card.Component key={card.id} data={data} />
      ))}
    </aside>
  );
}
