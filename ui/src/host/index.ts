// The kernel's UI surface for a package's pages (kernel step 1,
// docs/kernel/SURFACE.md, "The UI side"): what every space's pages share and a
// package's page may use, beyond the portable kit (ui/src/kit). The SDK's UI
// entry (kit/sdk/ui.ts) re-exports this file, and reaches the hub's app only
// through it and the two pieces tests/unit/kitPortable.test.ts names.
//
// Named one by one, never `export *`: a name joins when a package's page needs
// it and it means the same in any space type. Narrow where the hub's own is
// wide: a page reads the viewer through useViewer(), not the hub's whole
// sign-in state, and the space through useSpace(), not the hub's config.

import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import { theName } from "../../../src/shared/hubCopy";

// --- Calling the kernel's API: the session, errors as ApiError, the read cache ----------
export { request as apiRequest } from "../services/http";
export { ApiError } from "../utils/httpError";
export { useApi, type ApiState, type UseApiOptions } from "../hooks/useApi";
export { useAction, type ActionRunner } from "../hooks/useAction";

// --- Signing in before acting ------------------------------------------------------------
export { useRequireAuth } from "../hooks/useRequireAuth";
// Taking part (a vote, a response, a submission): the one-time About-you card first.
export { askAboutYouFirst } from "../services/aboutYou";
export { default as AuthModal } from "../components/AuthModal";

/** Who is reading the page, as a package's page may know it. */
export interface Viewer {
  /** True until the session has been read. */
  loading: boolean;
  /** The viewer's actor id, or null when signed out. */
  actorId: string | null;
  /** Signed in and able to take part (a member of the space). */
  canParticipate: boolean;
  /** One of the space's admins. */
  isAdmin: boolean;
  /** May post for the space: an admin, or someone the admins list as an author (requireAuthor on the server). */
  mayPostForSpace: boolean;
}

export function useViewer(): Viewer {
  const { loading, actorId, canParticipate, isAdmin, canPostAnnouncements } = useAuth();
  return { loading, actorId, canParticipate, isAdmin, mayPostForSpace: canPostAnnouncements };
}

/** The space the page is in, as a package's page may know it. */
export interface SpaceView {
  /** What the space calls itself. */
  name: string;
  /** Its name in running text: "the Floyd Civic Hub", or a name that needs no article as it is. */
  theName: (capital?: boolean) => string;
  /**
   * What the space serves, in running text ("what you love about …"): its
   * place where it has one ("Floyd County" on a Civic Hub), else its name, else
   * "where you live". The UI side of the kernel's spacePlace().
   */
  place: string;
  /** Its IANA time zone, the one every time is shown in (as hubTimeZone()). */
  timeZone: string;
}

export function useSpace(): SpaceView {
  const hub = useHub();
  const name = hub.name;
  return { name, theName: (capital = false) => theName(name, capital), place: hub.place, timeZone: hub.timeZone };
}

// --- The parts every process page shares ---------------------------------------------------
export { default as ProcessHeader } from "../components/ProcessHeader";
export { statusDisplay, type StatusDisplay } from "../components/statusDisplay";
export { default as AdminArchiveButton } from "../components/AdminArchiveButton";
export { default as Creator } from "../components/Creator";
export { default as ShareButton, type ShareButtonProps, type ShareNudge } from "../components/ShareButton";
export { default as RelatedProcesses } from "../components/RelatedProcesses";
export { default as SampleBadge } from "../components/SampleBadge";
// The kernel's totals by group (districts and demographics): mount it on a finished process's page.
export { default as ResultsBreakdown } from "../components/ResultsBreakdown";
export { default as Modal } from "../components/Modal";

// --- A post's picture and links -----------------------------------------------------------
export { default as PostFeaturedImage } from "../components/PostFeaturedImage";
export { default as PostImagePicker } from "../components/PostImagePicker";
export { default as LinkPreviewCard } from "../components/LinkPreviewCard";

// --- The right column: tell it something it shows has changed ------------------------------
export { refreshAside } from "../aside/asideFacts";

// --- Dates, in the space's zone where it takes one ------------------------------------------
export { absoluteTime, formatDate, localShortDate, relativeTime } from "../utils/dates";
export { dayFromToday, dayOf, endOfDay, shortDay } from "../components/boardDates";
export { formatCount } from "../processes/feedText";
export { safeReturnPath } from "../config/pluginRules";

// --- A plugin's settings panel: the settings page's own fields ----------------------------
export {
  BooleanField,
  ChoiceField,
  DateField,
  EmailField,
  HourField,
  NumberField,
  ProcessField,
  TextAreaField,
  TextField,
  UrlField,
  type FormApi,
} from "../pages/settings/pluginFields";
