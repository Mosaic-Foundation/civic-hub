// The Pinning plugin's UI module (ui/src/features.ts): the Pin control on
// every item's page, the Pinned card in the right column, the urgent line
// across the top of the pages, Admin → Pinned, and its panel on the Plugins
// page (who may pin).

import { lazy } from "react";
import type { FeatureUi } from "../../ui/src/features";
import { ChoiceField } from "../../ui/src/pages/settings/fields";
import PinButton from "./ui/PinButton";
import PinnedCard from "./ui/PinnedCard";
import UrgentLine from "./ui/UrgentLine";
import { WHO_CAN_PIN_KEY } from "./rules";

const AdminPinned = lazy(() => import("./ui/AdminPinned"));

const WHO_LABELS: Record<string, string> = {
  admins: "Admins only",
  members: "Every member",
};

const pinningUi: FeatureUi = {
  feature: "pinning",
  routes: [{ path: "/admin/pinned", element: <AdminPinned />, admin: true }],
  adminTab: { label: "Pinned", path: "/admin/pinned", icon: "pin", group: "community" },
  itemAction: PinButton,
  asideCards: [
    {
      id: "pinned",
      name: "Pinned",
      about: "What was pinned, urgent ones first.",
      order: 20,
      Component: PinnedCard,
    },
  ],
  pageTop: UrgentLine,
  settingsPanel: (f) => (
    <ChoiceField
      f={f}
      k={WHO_CAN_PIN_KEY}
      label="Who can pin"
      labels={WHO_LABELS}
      hint="Whoever may pin may also mark a pin urgent. Admin → Pinned lists everything pinned."
    />
  ),
};

export default pinningUi;
