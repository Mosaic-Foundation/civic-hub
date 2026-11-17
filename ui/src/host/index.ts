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
export { request as apiRequest, upload as apiUpload } from "../services/http";
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
  /** What the people taking part are called, by count (as the kernel's hubContext().participantNoun). */
  participantNoun: (count: number) => string;
  /**
   * The body that governs its place, where the space names one ("Floyd County
   * Board of Supervisors"); "" when it names none, and a page drops the phrase.
   */
  governingBodyName: string;
}

export function useSpace(): SpaceView {
  const hub = useHub();
  const name = hub.name;
  return {
    name,
    theName: (capital = false) => theName(name, capital),
    place: hub.place,
    timeZone: hub.timeZone,
    participantNoun: (count) => hub.noun(count),
    governingBodyName: hub.governing_body_name,
  };
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
export { default as RichText } from "../components/RichText";
export { default as SourceLinks } from "../components/SourceLinks";
export { default as EditHistory } from "../components/EditHistory";
export { default as DetailActions } from "../components/DetailActions";
export { CloseEarlyButton, ClosedEarlyNote } from "../components/CloseEarly";
export { default as ShareMoment } from "../components/ShareMoment";
// What people wrote on a process, and the form to add to it (every type's page).
export { default as CommunityInputPanel } from "../components/CommunityInputPanel";
export { default as CommentForm } from "../components/ProposalCommentForm";
// Briefs' pointer from a finished process to its brief. Step 3 makes it a
// contribution Briefs registers (docs/kernel/SURFACE.md, "Event"); until then
// the page mounts it and it shows nothing while Briefs is off.
export { BriefPointer } from "../components/BriefPointer";
export type { ClosedEarly, EarlyCloseOffer, UploadedImage } from "../services/api";
// Editing a live process (a type whose editPolicy allows it): what may change now, and the draft an edit opens.
export { getEditPolicy, startProcessEdit, type EditPolicy } from "../services/api";

// --- A type's list page ----------------------------------------------------------------------
export { default as ProcessPicker } from "../components/ProcessPicker";
export { default as StatusFilter } from "../components/StatusFilter";
export { useStatusFilter, type StatusFilterChoice } from "../components/statusFilterState";
export { default as ProcessListCard } from "../components/ProcessListCard";
export { cardDate } from "../components/cardDate";

// --- Drafting: the kernel's draft page, configured by a type's kind, and the parts its form is built from ---
export { default as DraftPage } from "../pages/draft/DraftPage";
export { reviewDestination, type DraftKindConfig, type DraftFormProps, type DraftPageContext } from "../pages/draft/types";
export { DAY_MS, durationLabel } from "../pages/draft/durations";
export { demoSubmitNote } from "../config/demoCopy";
export { default as ProcessLinkField } from "../components/ProcessLinkField";
export { default as MarkdownTextarea } from "../components/MarkdownTextarea";
export { default as SuggestFooterButton } from "../components/SuggestFooterButton";
export { default as TitleField } from "../components/TitleField";
export { default as DraftFooter } from "../components/DraftFooter";
export { FieldFinding } from "../components/CocFindings";
export { FieldGuide } from "../components/FieldGuide";
export { hardFindings } from "../components/cocFindingsState";
export { useDebouncedFields } from "../hooks/useDebouncedFields";
export type { AssistantFieldGuidance, DraftCategory, DraftSuggestion, ProposedLink } from "../services/api";

// --- A post's picture and links -----------------------------------------------------------
export { default as PostFeaturedImage } from "../components/PostFeaturedImage";
export { default as PostImagePicker } from "../components/PostImagePicker";
export { default as LinkPreviewCard } from "../components/LinkPreviewCard";

// --- The right column: tell it something it shows has changed ------------------------------
export { refreshAside } from "../aside/asideFacts";

// --- An admin page: its pinned filter bar, a review page's way back, a publication's status,
// and its review queue's "seen" mark (the admin tabs' counts refetch after it) --------------
export { AdminBackButton, AdminStickyBar } from "../components/AdminSticky";
export { StatusChip as PublicationStatusChip, type PublicationStatus } from "../components/AdminPublicationReview";
export { adminMarkQueueSeen as markAdminQueueSeen, notifyAdminQueuesChanged, type AdminQueue } from "../services/api";

// --- Dates, in the space's zone where it takes one ------------------------------------------
export {
  absoluteDateOfDay,
  absoluteTime,
  formatDate,
  localDateAtTime,
  localShortDate,
  localShortDateOfDay,
  relativeTime,
} from "../utils/dates";
export { dayFromToday, dayOf, endOfDay, shortDay } from "../components/boardDates";
export { formatCount, formatDuration, formatMeetingDate } from "../processes/feedText";
export { safeReturnPath } from "../config/pluginRules";

// --- A plugin's settings panel: the settings page's own fields ----------------------------
export {
  BooleanField,
  ChoiceField,
  ParticipationValues,
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
