// The admin bar (design pass, decision 4, 2026-10-29): inside admin, the hub's
// section tabs give way to one bar in a different tone, titled "Admin", with
// the way back to the hub at its left and the admin tabs on it. Nothing else
// is stacked under the hub header. In the left-column layout at desktop width
// the column carries the same list instead (Sidebar.tsx), so this bar is
// drawn only in the top layout and on phones.
//
// Each tab is a link; the current one has aria-current="page" and is marked
// by an underline and weight, not colour alone.

import { Link } from "react-router-dom";
import NavIcon from "./navIcons";
import { useAdminNav } from "../hooks/useAdminNav";
import "./AdminBar.css";

export default function AdminBar() {
  const items = useAdminNav();
  return (
    <div className="admin-bar" data-testid="admin-bar">
      <div className="admin-bar-inner">
        <div className="admin-bar-head">
          <Link to="/" className="admin-bar-back">
            <NavIcon name="back" size={16} />
            <span>Back to the hub</span>
          </Link>
          <span className="admin-bar-title" aria-hidden="true">
            Admin
          </span>
        </div>
        <nav className="admin-bar-tabs admin-tabs" aria-label="Admin sections">
          {items
            .filter((item) => !item.href)
            .map((item) => (
              <Link
                key={item.id}
                to={item.to!}
                className={`admin-tab${item.current ? " is-active" : ""}`}
                aria-current={item.current ? "page" : undefined}
                data-nav-id={item.id}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <span className="admin-tab-badge" aria-label={item.countLabel}>
                    {item.count}
                  </span>
                )}
              </Link>
            ))}
        </nav>
        {/* Off to the docs, and outside the scrolling tabs so it is always in view. */}
        {items
          .filter((item) => item.href)
          .map((item) => (
            <a key={item.id} href={item.href} target="_blank" rel="noopener" className="admin-bar-guide" data-nav-id={item.id}>
              {item.label}
            </a>
          ))}
      </div>
    </div>
  );
}
