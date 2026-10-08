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
      <span className="beta-banner-text">
        This is a demo hub.{" "}
        <span className="beta-banner-sub">Content marked Sample is illustrative, not public record.</span>{" "}
        {/* The daily sample refresh (2026-10-07) replaces a sample near its deadline. */}
        <span className="beta-banner-sub">
          Sample items refresh from time to time; anything you add to them may be cleared.
        </span>
      </span>
      {isAdmin && (
        <Link className="beta-banner-cta" to="/admin/settings/sample">
          Remove sample content
        </Link>
      )}
    </div>
  );
}
