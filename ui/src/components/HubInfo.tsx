import { useHub } from "../config/hub";

/**
 * Hub identity text: jurisdiction name, hub label, and tagline. Rendered on
 * pages that show the hub header. Pairs with HubBanner (the image strip)
 * but is intentionally standalone so pages can compose them independently.
 *
 * The hub's logo (identity.logo_url), when it has one, sits at the right
 * edge across from the place name, and the text keeps the left edge, tagline
 * included, full width (Adam, 2026-10-14; it sat left of the name from
 * 2026-09-24, which pushed every line of text in by the logo's width).
 */
export default function HubInfo() {
  const hub = useHub();
  return (
    <header className={`hub-info${hub.logo_url ? " hub-info--with-logo" : ""}`}>
      <div className="hub-info-text">
        <h1 className="hub-name">{hub.jurisdiction}</h1>
        <span className="hub-label">
          {hub.label}
          {hub.location && ` · ${hub.location}`}
        </span>
      </div>
      {hub.logo_url && (
        // Decorative: the place name beside it says what it is.
        <img src={hub.logo_url} alt="" className="hub-info-logo" />
      )}
      <p className="hub-tagline">{hub.tagline}</p>
    </header>
  );
}
