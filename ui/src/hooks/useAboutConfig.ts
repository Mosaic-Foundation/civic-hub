import { useHub } from "../config/hub";
import { aboutConfig, type AboutConfig } from "../../../src/shared/aboutYou";

/** The hub's About-you settings (districts and demographics): its district term, list and questions. */
export function useAboutConfig(): AboutConfig {
  const hub = useHub();
  return aboutConfig((key) => hub.setting(key));
}
