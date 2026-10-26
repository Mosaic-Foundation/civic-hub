// Admin routes — proposal moderation and other admin surfaces.
// Every route requires the authenticated user's email to be listed in
// the CIVIC_ADMIN_EMAILS env var.

import { requirePlugin } from "../middleware/pluginGate.js";
import { mountPackageRoutes } from "../plugins/mount.js";
import { Router } from "express";
import { handleAdminQueueCounts, handleMarkAdminQueueSeen } from "../controllers/adminQueueController.js";
import { handleAdminListEdits } from "../controllers/editNotificationController.js";
import {
  handleGetSettings,
  handlePatchSettings,
} from "../controllers/adminSettingsController.js";
import {
  handleGetHubSettings,
  handlePutHubSettings,
  handleGetSettingTemplate,
  handleGetPluginLiveCounts,
  handleGetJobRuns,
} from "../controllers/hubSettingsController.js";
import {
  handleAdminListReviews,
  handleAdminGetReview,
  handleAdminApprove,
  handleAdminRequestChanges,
  handleAdminDecline,
} from "../controllers/reviewController.js";
import {
  handleGetModerationLog,
  handleHideComment,
  handleRestoreComment,
} from "../controllers/moderationController.js";
import { handleGetHubAdminLog } from "../controllers/hubAdminLogController.js";
import {
  handleArchiveProcess,
  handleRestoreProcess,
  handleListArchivedProcesses,
} from "../controllers/adminArchiveController.js";
import {
  handleAdminListFeedback,
  handleContactCivicSocial,
  handleForwardFeedback,
} from "../controllers/adminFeedbackController.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  handleGetModeReadiness,
  handleRequestModeChangeCode,
  handleSetHubMode,
} from "../controllers/hubModeController.js";
import { handleRequestStepUpCode } from "../controllers/adminStepUp.js";
import {
  handleGetHubPeople,
  handleSetHubPeople,
} from "../controllers/hubPeopleController.js";
import {
  handleGetSampleContent,
  handleRemoveSampleContent,
  handleDeleteOneSample,
  handleRequestSampleRemovalCode,
} from "../controllers/hubSampleContentController.js";
import { handleAdminListMembers } from "../controllers/membersController.js";
import { handleInstallPlugin, handleListPluginInstalls, handleRemovePlugin } from "../controllers/hubPluginsController.js";

const router = Router();

router.use(requireAdmin);

// Plugin-specific admin surfaces answer 404 on a hub with the plugin off
// (src/middleware/pluginGate.ts). The shared queues — reviews, archived,
// edits, moderation of comments — belong to no one plugin and stay.
router.use("/feedback", requirePlugin("feedback"));

// The plugin packages' admin routes (ADR-014), each behind its plugin's
// switch and the loader's verdict, after the admin check above.
mountPackageRoutes(router, "adminRoutes");


// Process reviews (collaborative admin review before publication)
router.get("/reviews", handleAdminListReviews);
router.get("/reviews/:reviewId", handleAdminGetReview);
router.post("/reviews/:reviewId/approve", handleAdminApprove);
router.post("/reviews/:reviewId/request-changes", handleAdminRequestChanges);
router.post("/reviews/:reviewId/decline", handleAdminDecline);

// Archive / restore (generic soft-remove across process types) + the
// admin Archived view. Archiving hides an item from the public list, direct
// fetch, feed, and digest while keeping it restorable.
router.get("/archived", handleListArchivedProcesses);

// Edits of live processes (any type) — the admin's overview; opening the tab
// stamps the same edits_seen_at cursor via POST /notifications/edits/seen.
router.get("/edits", handleAdminListEdits);
router.post("/processes/:id/archive", handleArchiveProcess);
router.post("/processes/:id/restore", handleRestoreProcess);

// Feedback archive (read-only). Everything residents sent through the
// feedback form, newest first, optionally filtered to one category.
// Read-only on purpose — see adminFeedbackController.
router.get("/feedback", handleAdminListFeedback);
// "Send to Civic.Social" for one item (feedback routing, 2026-10-13).
router.post("/feedback/:id/forward", handleForwardFeedback);
// An admin's own message to Civic.Social. Not behind the Feedback plugin.
router.post("/contact-civic-social", handleContactCivicSocial);

// The numbers on the admin tabs and the account-menu dot: what is new in
// each queue since this admin last opened that tab. Opening a tab stamps
// its cursor. See services/adminQueues.ts.
router.get("/queue-counts", handleAdminQueueCounts);
router.post("/queues/:queue/seen", handleMarkAdminQueueSeen);

// Hub settings (admin-configurable; overrides env var fallbacks)
// Changing what the hub IS takes a fresh code, not just an open admin tab.
// See src/controllers/adminStepUp.ts for which acts and why.
router.get("/hub/mode/readiness", handleGetModeReadiness);
router.post("/hub/mode/request-code", handleRequestModeChangeCode);
router.post("/hub/mode", handleSetHubMode);

// Who administers this hub. A settings row, not an env var — see
// src/controllers/hubPeopleController.ts. Same step-up as a mode change:
// adding an admin makes access permanent, removing them makes it exclusive.
router.get("/hub/people", handleGetHubPeople);
router.get("/hub/members", requirePlugin("members"), handleAdminListMembers);
router.post("/hub/people/request-code", handleRequestStepUpCode);
router.post("/hub/people", handleSetHubPeople);

// Sample content (Phase 7): what removal would take, and the removal itself,
// in every mode. Same step-up: it cannot be undone, and it takes real
// people's input on sample processes with it.
router.get("/hub/sample-content", handleGetSampleContent);
router.post("/hub/sample-content/request-code", handleRequestSampleRemovalCode);
router.post("/hub/sample-content/remove", handleRemoveSampleContent);
// One sample at a time, no code (Adam, 2026-10-13).
router.delete("/hub/sample-content/:id", handleDeleteOneSample);

// Settings → Admin log: what this hub's admins did with a fresh code, and
// the other actions recordHubAdminAudit() keeps. Read-only.
router.get("/hub/admin-log", handleGetHubAdminLog);

// What the hub is called, what its pages say, its legal documents and its
// mail — every key checked against the build plan's list. See
// src/controllers/hubSettingsController.ts.
router.get("/hub/settings", handleGetHubSettings);
router.put("/hub/settings", handlePutHubSettings);
router.get("/hub/settings/template/:key", handleGetSettingTemplate);
// Live items per plugin, for the Plugins page's switch-off warning.
router.get("/hub/plugins/live", handleGetPluginLiveCounts);
// Plugin packages' installs: Install, Remove (Stop now or Wind down) (ADR-014).
router.get("/hub/plugins/installs", handleListPluginInstalls);
router.post("/hub/plugins/:plugin/install", handleInstallPlugin);
router.post("/hub/plugins/:plugin/remove", handleRemovePlugin);
// Each scheduled job's last run, for the Plugins page (job_runs, 20260929000000).
router.get("/hub/jobs/runs", handleGetJobRuns);

router.get("/settings", handleGetSettings);
router.patch("/settings", handlePatchSettings);

// Moderation (Slice 11). Every action emits a restricted-visibility
// civic.process.updated event for the audit trail; the moderation log
// reads those events back. Routes deliberately mirror the resource
// they act on so admins can navigate between them in muscle memory.
router.post("/moderation/comments/:commentId/hide", handleHideComment);
router.post("/moderation/comments/:commentId/restore", handleRestoreComment);
router.get("/moderation/log", handleGetModerationLog);

export default router;
