// The host's feature packages' UI modules (ADR-016), for ui/src/features.ts.
// Their console views are config/featureConsole.ts (the console is its own app).

import type { FeatureUi } from "../ui/src/features";
import analyticsUi from "../features/analytics/ui";

export const FEATURE_UI_MODULES: readonly FeatureUi[] = [analyticsUi];
