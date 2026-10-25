// The demo bar (Phase 7): on every page of a hub in `demo` mode. A demo hub
// usually opens with sample content, and this is where the Sample badge on
// that content is explained. Its admin gets the way out: a link to Settings →
// Sample content. Beta keeps its own bar (BetaBanner); live has none.

import { Link } from "react-router-dom";
import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import ModeNotice from "./ModeNotice";

export default function DemoBanner() {
  const { isAdmin } = useAuth();
  const hub = useHub();
  // Gone once no sample is left (admin menu slice, 2026-10-13); Settings
  // refreshes the config after each delete, so it goes without a reload.
  const samplesLeft = hub.config?.content?.samples ?? true;
  return (
    // Closable since the navigation polish (Adam, 2026-10-14): closed, a thin
    // "Demo hub" bar stays, Remove samples still on its right for admins.
    <ModeNotice
      label="Demo notice"
      short="Demo hub"
      className="demo-banner"
      // Two lines at most on a phone (session 4; it ran to four). "Reset"
      // covers the daily sample refresh (2026-10-07), which replaces a
      // sample near its deadline along with anything added to it.
      message="A demo hub: items marked Sample aren't real, and are reset from time to time."
      action={
        isAdmin &&
        samplesLeft && (
          <Link className="beta-banner-cta" to="/admin/settings/sample">
            Remove samples
          </Link>
        )
      }
    />
  );
}
