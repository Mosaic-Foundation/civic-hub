// civic.announcement module — public surface

export type {
  AnnouncementActionOutcome,
  AnnouncementAuthorRole,
  AnnouncementContent,
  AnnouncementContentPatch,
  AnnouncementLink,
  AnnouncementModeration,
  AnnouncementProcessContext,
  AnnouncementProcessState,
  AnnouncementSource,
  CreateAnnouncementInput,
  EmitEventFn,
} from "./models.js";

export {
  BODY_MAX,
  BODY_PREVIEW_LEN,
  IMAGE_ALT_MAX,
  IMAGE_URL_MAX,
  LINK_LABEL_MAX,
  LINK_URL_MAX,
  LINKS_MAX,
  MODERATION_REASON_MAX,
  TITLE_MAX,
} from "./models.js";

export { canEdit } from "./lifecycle.js";

export {
  createAnnouncementState,
  emitPublicationEvents,
  getAdminReadModel,
  getPublicReadModel,
  getPublicSummary,
  removeAnnouncement,
  restoreAnnouncement,
  updateAnnouncement,
} from "./service.js";

export {
  emitAnnouncementCreated,
  emitAnnouncementResultPublished,
  emitAnnouncementUpdated,
} from "./events.js";

// What this type is: ANNOUNCEMENT_DESCRIPTOR in src/modules/civic.announcement/handler.ts.
