// One list of navigation items, as the More sheet and the sidebar draw them
// (navigation slice, 2026-10-14): icon, word, count. The current page is
// marked with aria-current="page" and drawn with a shape and weight, not
// colour alone.

import { Link } from "react-router-dom";
import NavIcon from "./navIcons";
import type { NavItem } from "../hooks/useNavGroups";
import "./NavItemList.css";

export default function NavItemList({
  items,
  onPicked,
  className,
  label,
}: {
  items: readonly NavItem[];
  /** After a link is followed or an action runs: the sheet closes. */
  onPicked?: () => void;
  className: string;
  /** Names the list for a screen reader when its group has no visible heading. */
  label?: string;
}) {
  return (
    <ul className={className} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <Row item={item} onPicked={onPicked} />
        </li>
      ))}
    </ul>
  );
}

function Row({ item, onPicked }: { item: NavItem; onPicked?: () => void }) {
  const cls = `nav-item${item.current ? " is-current" : ""}${item.tone === "danger" ? " nav-item--danger" : ""}`;
  const inner = (
    <>
      <NavIcon name={item.icon} size={20} />
      <span className="nav-item-text">
        <span className="nav-item-label">{item.label}</span>
        {item.sub && <span className="nav-item-sub">{item.sub}</span>}
      </span>
      {item.count !== undefined && item.count > 0 && (
        <span className="nav-item-count" aria-label={item.countLabel}>
          {item.count.toLocaleString()}
        </span>
      )}
    </>
  );
  if (item.to) {
    return (
      <Link
        to={item.to}
        className={cls}
        aria-current={item.current ? "page" : undefined}
        data-nav-id={item.id}
        onClick={() => onPicked?.()}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      data-nav-id={item.id}
      onClick={() => {
        onPicked?.();
        item.onSelect?.();
      }}
    >
      {inner}
    </button>
  );
}
