// The Pinned card in the right column (2026-11-15; the Pinning plugin's since
// kernel step 4): the items pinned now, urgent ones first, each naming its
// type ("Vote"). Nothing pinned: no card. Past BOARD_SHOWN rows the list
// scrolls inside the card.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StatusChip } from "../../../ui/src/kit";
import { localShortDate } from "../../../ui/src/utils/dates";
import { AsideCard } from "../../../ui/src/aside/cards";
import { BOARD_SHOWN } from "../rules";
import { loadBoard, onBoardChanged, type Board } from "./api";

/** The card's read, shared with the urgent line and the Pin buttons. */
export function useBoard(): Board | null {
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void loadBoard().then((b) => {
        if (live) setBoard(b);
      });
    read();
    const off = onBoardChanged(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  return board;
}

export default function PinnedCard() {
  const board = useBoard();
  // Memoized so a space with nothing pinned doesn't hand the layout effect a new [] every render.
  const items = board?.items;
  const list = useMemo(() => items ?? [], [items]);
  const scrolls = list.length > BOARD_SHOWN;
  const listRef = useRef<HTMLUListElement>(null);
  // Three rows high, and a sliver of the fourth so the list reads as one to scroll.
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    if (!scrolls) {
      ul.style.maxHeight = "";
      return;
    }
    const third = ul.children[BOARD_SHOWN - 1] as HTMLElement | undefined;
    if (third) ul.style.maxHeight = `${third.offsetTop - ul.offsetTop + third.offsetHeight + 20}px`;
  }, [scrolls, list]);
  if (list.length === 0) return null;
  return (
    <AsideCard id="pinned" title="Pinned">
      <ul
        ref={listRef}
        className={`aside-rows aside-rows--plain${scrolls ? " aside-rows--scroll" : ""}`}
        {...(scrolls ? { tabIndex: 0, "aria-label": `${list.length} pinned items` } : {})}
      >
        {list.map((a) => (
          <li key={a.process_id}>
            <Link to={a.url} className="aside-row aside-row--plain">
              <span className="aside-row-text">
                <span className="aside-row-title">{a.title}</span>
                <span className="aside-row-meta">
                  {a.urgent && <StatusChip tone="alert">Urgent</StatusChip>}
                  <span>{a.type_label}</span>
                  <span aria-hidden="true">·</span>
                  {!a.urgent && (
                    <>
                      <span>Pinned</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  {localShortDate(a.published_at)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AsideCard>
  );
}
