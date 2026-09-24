import hub from "../config/hub";

/**
 * Hub identity text: jurisdiction name, hub label, and tagline. Rendered on
 * pages that show the hub header. Pairs with HubBanner (the image strip)
 * but is intentionally standalone so pages can compose them independently.
 *
 * The hub's logo (identity.logo_url), when it has one, sits to the left of
 * the place name at a size where a mark reads as a mark. It moved here from
 * the nav bar on 2026-09-24: at text height it was too small to recognise.
 */
export default function HubInfo() {
  return (
    <header className={`hub-info${hub.logo_url ? " hub-info--with-logo" : ""}`}>
      {hub.logo_url && (
        // Decorative: the place name beside it says what it is.
        <img src={hub.logo_url} alt="" className="hub-info-logo" />
      )}
      <div className="hub-info-text">
        <h1 className="hub-name">{hub.jurisdiction}</h1>
        <span className="hub-label">{hub.label}</span>
        <p className="hub-tagline">{hub.tagline}</p>
      </div>
    </header>
  );
}
