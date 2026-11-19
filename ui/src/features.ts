// Every feature package's UI module (ADR-016; src/plugins/feature.ts), from
// config/featureUi.ts. A feature contributes what a process type's module does
// (routes, a settings panel) and what only a feature has: an Admin tab, an
// item in the Admin menu, a block on the About page, and (kernel step 4, for
// Pinning) a control on every item's page, a card in the right column and a
// line across the top of the pages, and (for Feedback) a page for everyone
// linked from the top bar, the menus and the footer. Each is shown only while
// the feature's switch is on; the kernel names no feature.

import type { ComponentType, ReactNode } from "react";
import type { FormApi } from "./pages/settings/pluginFields";
import type { ProcessRoute } from "./processes/types";
import type { PluginId } from "./config/plugins";
import type { AsideCardUi } from "./aside/registry";
import { FEATURE_UI_MODULES } from "../../config/featureUi";

export interface FeatureUi {
  /** Its hub feature: the switch everything below rides on. */
  feature: PluginId;
  routes: readonly ProcessRoute[];
  /**
   * A tab in the admin tabs, and an item in the Admin menu and the
   * navigation's Admin group (icon: navIcons.tsx). With `group: "community"`
   * it sits in the admin rail's Community group instead (beside Moderation).
   */
  adminTab?: {
    label: string;
    path: string;
    icon: string;
    group?: "community";
    /** Its admin queue (FeatureServer.queues): the tab shows what is new there since the admin last opened it. */
    queue?: string;
  };
  /**
   * A page for everyone on the space (Feedback's form): a link in the
   * sidebar's space group, the menu drawer and the footer, and with `header`
   * a button in the top bar.
   */
  spaceLink?: SpaceLink;
  /**
   * A tool in the top bar, between the links and the account (Search's box),
   * and at the top of the menu drawer (`inDrawer`, full width; call
   * `onSubmitted` to close the drawer).
   */
  navTool?: ComponentType<{ inDrawer?: boolean; onSubmitted?: () => void }>;
  /**
   * A control in the action row at the foot of every type's page, beside
   * Archive (components/archiveSlot.tsx). Drawn for any signed-in reader; it
   * draws nothing for one it has nothing for.
   */
  itemAction?: ComponentType<{ processId: string }>;
  /** Cards for the right column (aside/registry.ts), listed in its editor while the feature is on. */
  asideCards?: readonly AsideCardUi[];
  /** Drawn across the top of every page outside Admin (App.tsx), on every width. */
  pageTop?: ComponentType;
  settingsPanel?: (f: FormApi) => ReactNode;
  /** Drawn at the foot of the About page. */
  aboutBlock?: ComponentType;
  /**
   * A section of Admin → Activity, drawn after "By kind" for the period the
   * admin is looking at (YYYY-MM-DD, inclusive). For numbers that are not
   * residents taking part (the fediverse feature's followers), so they sit
   * apart from the participation counts.
   */
  activitySection?: ComponentType<{ start: string; end: string; label: string }>;
}

export interface SpaceLink {
  path: string;
  /** In the sidebar's space group ("Feedback"). */
  label: string;
  /** Its icon there (navIcons.tsx). */
  icon: string;
  /** In the drawer and the footer ("Send feedback"). */
  longLabel: string;
  /** A button in the top bar: its visible label, its name for screen readers and its icon. */
  header?: { label: string; ariaLabel: string; Icon: ComponentType };
  /** Open to a logged-out visitor on a beta space, without the welcome dialog over it. */
  publicInBeta?: boolean;
  /**
   * A form about the page the person came from: the page before it is what a
   * report is about (services/lastPage.ts).
   */
  formPage?: boolean;
  /** Finishes the default welcome strip's "It's early and still evolving" ("— use Feedback anytime to …"). */
  welcomeNote?: string;
  /** A line in the beta welcome dialog pointing to it. */
  betaNote?: ReactNode;
}

export const FEATURE_UI: readonly FeatureUi[] = FEATURE_UI_MODULES;

/** The space links of the features that are on, in the features' order. */
export function featureSpaceLinks(enabled: (id: PluginId) => boolean): ReadonlyArray<SpaceLink & { feature: PluginId }> {
  return FEATURE_UI.flatMap((u) => (u.spaceLink && enabled(u.feature) ? [{ feature: u.feature, ...u.spaceLink }] : []));
}

/** The top-bar tools of the features that are on. */
export function featureNavTools(enabled: (id: PluginId) => boolean): ReadonlyArray<{ feature: PluginId; Tool: NonNullable<FeatureUi["navTool"]> }> {
  return FEATURE_UI.flatMap((u) => (u.navTool && enabled(u.feature) ? [{ feature: u.feature, Tool: u.navTool }] : []));
}

/** Every feature's space link, on or off: the paths a visitor may reach in beta, and the form pages. */
export function allFeatureSpaceLinks(): readonly SpaceLink[] {
  return FEATURE_UI.flatMap((u) => (u.spaceLink ? [u.spaceLink] : []));
}

/** A feature's panel on the Plugins page, or null. */
export function featureSettingsPanel(id: string, f: FormApi): ReactNode | null {
  return FEATURE_UI.find((u) => u.feature === id)?.settingsPanel?.(f) ?? null;
}

/** The Activity sections of the features that are on. */
export function featureActivitySections(enabled: (id: PluginId) => boolean): ReadonlyArray<{ feature: PluginId; Section: NonNullable<FeatureUi["activitySection"]> }> {
  return FEATURE_UI.flatMap((u) => (u.activitySection && enabled(u.feature) ? [{ feature: u.feature, Section: u.activitySection }] : []));
}

/** The item-page controls of the features that are on. */
export function featureItemActions(enabled: (id: PluginId) => boolean): ReadonlyArray<{ feature: PluginId; Action: NonNullable<FeatureUi["itemAction"]> }> {
  return FEATURE_UI.flatMap((u) => (u.itemAction && enabled(u.feature) ? [{ feature: u.feature, Action: u.itemAction }] : []));
}

/** The lines across the top of the pages of the features that are on. */
export function featurePageTops(enabled: (id: PluginId) => boolean): ReadonlyArray<{ feature: PluginId; Top: NonNullable<FeatureUi["pageTop"]> }> {
  return FEATURE_UI.flatMap((u) => (u.pageTop && enabled(u.feature) ? [{ feature: u.feature, Top: u.pageTop }] : []));
}
