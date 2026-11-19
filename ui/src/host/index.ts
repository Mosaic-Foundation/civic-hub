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
import hub, { useHub } from "../config/hub";
import { theName } from "../../../src/shared/hubCopy";
import type { KernelTerm } from "../../../src/shared/spaceProfile";
export type { KernelTerm, KernelRole } from "../../../src/shared/spaceProfile";
import { getMe } from "../services/auth";
import { getStoredToken } from "../services/tokenStore";

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
  /** The office the viewer speaks for (requireOfficial on the server), or null. Since Briefs. */
  office: { type: string; title: string } | null;
  /** The name the viewer goes on the record under (full name, else display name), or null. */
  displayName: string | null;
}

/**
 * The signed-in viewer's actor id, read from the session when the page has
 * not loaded it yet (a vote cast before the page knew who was reading); ""
 * when nobody is signed in.
 */
export async function resolveActorId(): Promise<string> {
  const token = getStoredToken();
  if (!token) return "";
  try {
    return (await getMe(token)).user.id;
  } catch {
    return "";
  }
}

export function useViewer(): Viewer {
  const { loading, actorId, canParticipate, isAdmin, canPostAnnouncements, official, user } = useAuth();
  return {
    loading,
    actorId,
    canParticipate,
    isAdmin,
    mayPostForSpace: canPostAnnouncements,
    office: official,
    displayName: user?.full_name || user?.display_name || null,
  };
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
  /** The place it serves, short ("Floyd County"), or null where it serves none: the kernel's hubContext().placeName. */
  placeName: string | null;
  /** Its IANA time zone, the one every time is shown in (as hubTimeZone()). */
  timeZone: string;
  /** What the people taking part are called, by count (as the kernel's hubContext().participantNoun). */
  participantNoun: (count: number) => string;
  /**
   * A kernel word by count (as the kernel's hubContext().term): "resident",
   * "official" and "hub" on a Civic Hub, the space's own word where it set one.
   */
  term: (term: KernelTerm, count?: number) => string;
  /**
   * The body that governs its place, where the space names one ("Floyd County
   * Board of Supervisors"); "" when it names none, and a page drops the phrase.
   */
  governingBodyName: string;
  /** Its short form, for pills and running text ("Board of Supervisors"); "" when it names none. */
  governingBodyShort: string;
  /** The body in running text: "the Supervisors", else "the governing body". */
  governingBodyRef: string;
  /** The place it serves in full ("Floyd County, Virginia"), or its name where it serves no place. */
  jurisdiction: string;
  /** Whether a plugin is switched on in this space. */
  pluginEnabled: (pluginId: string) => boolean;
  /** One of the space's settings, "" when unset: a package reads its own (`plugin.<id>.…`). */
  setting: (key: string) => string;
}

/**
 * What the people taking part are called, by count, outside a component (a
 * feed card's engagement line); a page uses useSpace().participantNoun.
 */
export function participantNoun(count: number): string {
  return hub.noun(count);
}

export function useSpace(): SpaceView {
  return spaceViewOf(useHub());
}

/**
 * The space as it is now, outside a component (a feed card's line); a page
 * uses useSpace(), which follows a change. Since Briefs.
 */
export function spaceNow(): SpaceView {
  return spaceViewOf(hub);
}

function spaceViewOf(hub: ReturnType<typeof useHub>): SpaceView {
  const name = hub.name;
  return {
    name,
    theName: (capital = false) => theName(name, capital),
    place: hub.place,
    placeName: hub.isPlace ? hub.jurisdiction.split(",")[0]?.trim() || null : null,
    timeZone: hub.timeZone,
    participantNoun: (count) => hub.noun(count),
    term: (t, count) => hub.term(t, count),
    governingBodyName: hub.governing_body_name,
    governingBodyShort: hub.governing_body_short,
    governingBodyRef: hub.governing_body_ref,
    jurisdiction: hub.jurisdiction,
    pluginEnabled: (pluginId) => hub.plugins.enabled(pluginId as never),
    setting: (key) => hub.setting(key) ?? "",
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
// Adding to it from a type's own panel (a comment cast with a ballot).
export { submitInput, type CommunityInput } from "../services/api";
// What packages add at the top of a process page, under its header (kernel
// step 3: Briefs' pointer to the process's brief, while Briefs is on). A page
// mounts it once; the kernel draws each contribution and names no package.
// `BriefPointer` is its older name, kept for the pages that still say it.
export { ProcessPageTop, ProcessPageTop as BriefPointer } from "../components/PackageSlots";
export type { PackageContributions, AdminQueueTab } from "../processes/types";
export type { ClosedEarly, EarlyCloseOffer, UploadedImage } from "../services/api";
// Editing a live process (a type whose editPolicy allows it): what may change now, and the draft an edit opens.
export { getEditPolicy, startProcessEdit, type EditPolicy } from "../services/api";

// What the space lets a comment carry (a name, or anonymous), and telling the page's input
// list a new comment arrived (one cast with a ballot).
export { useCommentIdentityMode } from "../hooks/useCommentIdentityMode";
export { announceInput } from "../services/inputEvents";
// A "Label — url" source as a link, or null.
export { normalizeSourceLink } from "../components/sourceLinkParsing";
// Where a process's page is, which plugin a type belongs to, and the page a switched-off plugin's route shows.
export { detailPathOf, pluginOfType, typeName, manifestOf, briefColorSlug } from "../processes/display";
export { PluginOff } from "../components/PluginOff";
export type {
  ActionResult,
  CommunityInputConfig,
  OtherProcessState,
  ProcessSummaryBase,
} from "../services/api";

// A QR code's modules for text (a receipt file's link to its check page).
export { qrMatrix } from "../services/qr";

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

// --- An admin page: its pinned filter bar, a review page's way back, a publication's status,
// and its review queue's "seen" mark (the admin tabs' counts refetch after it) --------------
export { AdminBackButton, AdminStickyBar } from "../components/AdminSticky";
export { StatusChip as PublicationStatusChip, type PublicationStatus } from "../components/AdminPublicationReview";
// A publication's review queue and page (Briefs): the list, the review frame, its approve buttons.
export { ApproveActions, PublicationList, PublicationReview } from "../components/AdminPublicationReview";
export { default as ConfirmDialog } from "../components/ConfirmDialog";
export { adminMarkQueueSeen as markAdminQueueSeen, notifyAdminQueuesChanged, type AdminQueue } from "../services/api";

// --- Dates, in the space's zone where it takes one ------------------------------------------
export {
  absoluteDate,
  formatShortDate,
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

// --- Offices and results (since Briefs) ---------------------------------------------------
// An official's office pill (the kernel's OFFICIAL_TYPES), the officials roster and the
// space's result recipients (Officials settings), and how a published result's delivery reads.
export { authorBadges, OFFICIAL_TYPES, OFFICIAL_TYPE_LABELS, normalizeOfficialType, type OfficialType } from "../../../src/shared/officialTypes";
export { getOfficialsRoster, type Official, type HeldBackRecipient } from "../services/api";
// The line a feed card for an official's response carries (the digest writes the same).
export { briefResponseContext } from "../../../src/shared/feedActivity";
