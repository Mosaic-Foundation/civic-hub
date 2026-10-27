// Activity's UI module (ADR-016; ui/src/features.ts): the admin's Activity
// page, its Admin tab, the Plugins panel's Public numbers switch, and the
// About page's "This hub in numbers".

import { lazy } from "react";
import { BooleanField } from "../../ui/src/pages/settings/pluginFields";
import type { FeatureUi } from "../../ui/src/features";
import AboutNumbers from "./ui/AboutNumbers";

const ActivityPage = lazy(() => import("./ui/ActivityPage"));

const analyticsUi: FeatureUi = {
  feature: "analytics",
  routes: [{ path: "/admin/activity", element: <ActivityPage />, admin: true }],
  adminTab: { label: "Activity", path: "/admin/activity" },
  settingsPanel: (f) => (
    <BooleanField
      f={f}
      k="plugin.analytics.public_numbers"
      label="Public numbers"
      hint={
        <>
          Anyone can read this hub's Activity numbers at <code>/analytics</code>, and the About page shows them.
          Numbers from 1 to 4 read "fewer than 5". Off, only organisations you give a reporting key can read them
          (Admin → Activity).
        </>
      }
    />
  ),
  aboutBlock: AboutNumbers,
};

export default analyticsUi;
