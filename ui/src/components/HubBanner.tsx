import hub from "../config/hub";

/**
 * Banner image strip. Rendered at the very top of the page above the nav on
 * routes that should show hub identity. Kept deliberately separate from the
 * hub text (HubInfo) so each page can decide whether to show the image,
 * the text, both, or neither.
 */
export default function HubBanner() {
  // A hub that has not chosen a banner shows none. The default used to be
  // one hub's photograph, so every unconfigured hub wore a picture of
  // somewhere else — which reads as a claim about the place, not as a
  // missing asset.
  if (!hub.banner_url) return null;
  return (
    <div className="hub-banner" aria-hidden="true">
      <img src={hub.banner_url} alt="" className="hub-banner-img" />
    </div>
  );
}
