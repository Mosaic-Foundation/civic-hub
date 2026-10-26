// civic.announcement module — lifecycle helpers
//
// Announcements are instant-publish: no draft, scheduled, active, or
// closed state. The standard process.status is "finalized" from the
// moment of creation and stays there through edits.
//
// Authorization to edit:
//   - The original author can always edit their own announcement.
//   - A user with admin role can edit any announcement (e.g. to correct
//     a factual error or enforce policy).
//   - A non-admin author cannot edit another author's announcement.

import type { AnnouncementProcessState } from "./models.js";

/**
 * Permission role distinct from the display label (author_role). Used
 * only for authorization decisions.
 */
export type AnnouncementEditorRole = "admin" | "author";

export function canEdit(
  state: AnnouncementProcessState,
  editorId: string,
  editorRole: AnnouncementEditorRole,
): boolean {
  if (editorRole === "admin") return true;
  return state.author_id === editorId;
}
