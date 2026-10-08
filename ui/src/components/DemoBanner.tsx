// The demo bar (Phase 7): on every page of a hub in `demo` mode. A demo hub
// usually opens with sample content, and this is where the Sample badge on
// that content is explained. Its admin gets the way out: a link to Settings →
// Sample content. Beta keeps its own bar (BetaBanner); live has none.

import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./BetaBanner.css";

export default function DemoBanner() {
  const { isAdmin } = useAuth();
  return (
    <div className="beta-banner demo-banner" role="region" aria-label="Demo notice">
      {/* Two lines at most on a phone (session 4; it ran to four). "Reset"
          covers the daily sample refresh (2026-10-07), which replaces a
          sample near its deadline along with anything added to it. */}
      <span className="beta-banner-text">
        A demo hub: items marked Sample aren't real, and are reset from time to time.
      </span>
      {isAdmin && (
        <Link className="beta-banner-cta" to="/admin/settings/sample">
          Remove samples
        </Link>
      )}
    </div>
  );
}
