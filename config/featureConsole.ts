// The host's feature packages' console views (ADR-016), for the console's
// Dashboard (ui/src/console/dashboardSections.tsx), keyed by section id.

import type { SectionView } from "../ui/src/console/dashboardSections";
import { ANALYTICS_CONSOLE_VIEWS } from "../features/analytics/consoleView";

export const FEATURE_CONSOLE_VIEWS: Readonly<Record<string, SectionView>> = { ...ANALYTICS_CONSOLE_VIEWS };
