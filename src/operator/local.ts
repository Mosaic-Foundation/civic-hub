// The operator API, in-process (./api.ts): the hub's side of every console
// action, called directly while the console shares the hub deployment, and
// behind the HTTP router (./router.ts) once it does not.
//
// The hub's rules live here, not in the console: an archived hub refuses
// edits, samples refresh only on demo and beta hubs, a catalog entry's state
// decides what may happen to it.

import { RESERVED_HUB_SLUG_PURPOSES } from "../models/hub.js";
import { KEYS, PLUGIN_IDS } from "../models/hubSettings.js";
import { autoRefreshOn, refreshesSamples } from "../shared/sampleRefresh.js";
import { getHubBySlug } from "../db/hubs.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { withHubScope } from "../config/hubContext.js";
import { refreshSamples } from "../services/sampleRefresh.js";
import { describeJobRun } from "../jobs/describe.js";
import { recordJobRun } from "../services/jobRuns.js";
import { kindsWithSamples, samplePreviews, sampleTemplateTitles } from "../services/sampleTemplates.js";
import { sampleNames } from "../services/sampleNames.js";
import { describeInvites } from "../services/adminInvite.js";
import { legalSummaries } from "../services/hubDocuments.js";
import { countReceived } from "../db/platformFeedback.js";
import {
  ControlInputError,
  archiveHub,
  changedFields,
  configChangeNeedsStepUp,
  createHub,
  describeFollowOn,
  getHub,
  hubAdmins,
  hubAiLimits,
  hubConfigView,
  hubHandover,
  hubPlugins,
  hubSpecificEnvVars,
  listHubs,
  parseAdminList,
  parseConfigPatch,
  parseCreateInput,
  parseHandoverPatch,
  productionCreateGuard,
  setHubAdmins,
  unarchiveHub,
  updateHandover,
  updateHubAiLimits,
  updateHubConfig,
  validateHubConfig,
  withDerivedCode,
  type ControlHub,
} from "./hubs.js";
import { addStarterWordcloud, handoffUrl, hubSignInUrl, inviteAdmins, seedSampleInHub } from "./inHub.js";
import { checkSlug, listStates, searchJurisdictions, suggestSlug } from "./jurisdictions.js";
import { exportHubArchive } from "./hubExport.js";
import { listHubAdminAudit } from "./adminAudit.js";
import { isProductionDatabase, platformDomain } from "./platform.js";
import {
  CatalogStateError,
  approveEntry,
  catalogView,
  releaseApproveEntries,
  setEntryRequired,
  signApprovedEntries,
  withdrawEntry,
} from "./pluginCatalog.js";
import { feedbackInbox, updateFeedbackItem } from "./platformFeedback.js";
import { hubDashboardSections } from "./dashboard/registry.js";
import type { HubDetail, OperatorApi } from "./api.js";

async function requireHub(hubId: string): Promise<ControlHub> {
  const hub = await getHub(hubId);
  if (!hub) throw new ControlInputError("No such hub.", 404);
  return hub;
}

function refuseArchived(hub: ControlHub): void {
  if (hub.archived_at) throw new ControlInputError("This hub is archived.");
}

async function detailOf(hub: ControlHub): Promise<HubDetail> {
  return {
    hub,
    config: await hubConfigView(hub),
    handover: await hubHandover(hub),
    plugins: await hubPlugins(hub.id),
    admins: await hubAdmins(hub.id),
    ai_limits: await hubAiLimits(hub),
    // "Keep sample content fresh automatically" (2026-11-05): the hub admin's
    // switch, shown on the Sample content card.
    samples: { auto_refresh: autoRefreshOn((await fetchHubSettings(hub.id))[KEYS.SAMPLES_AUTO_REFRESH]) },
  };
}

/** A catalog change, its state errors answered as 409s. */
async function catalogChange<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CatalogStateError) throw new ControlInputError(err.message, 409);
    throw err;
  }
}

export function localOperator(): OperatorApi {
  return {
    async createInfo() {
      const hubs = await listHubs();
      return {
        platform_domain: platformDomain(),
        reserved_slugs: { ...RESERVED_HUB_SLUG_PURPOSES },
        plugin_ids: PLUGIN_IDS,
        // The create form disables "Start with sample content" for the rest.
        sample_kinds: kindsWithSamples(),
        production_database: isProductionDatabase(),
        hub_specific_env_vars: hubSpecificEnvVars(),
        create_refusal: productionCreateGuard(hubs.length),
        // The create form's preview: a sample card's first line, placeholders
        // and all, per "<kind>:<type>" (review R21).
        sample_previews: samplePreviews(),
      };
    },
    async parseCreate(body) {
      return parseCreateInput(body);
    },
    createHub: (input, opts) => createHub(input, opts),
    seedSamples: (hubId) => seedSampleInHub(hubId),
    addStarterWordcloud: (hubId, by) => addStarterWordcloud(hubId, by),
    async inviteAdmins(hubId, emails) {
      const report = await inviteAdmins(hubId, emails);
      return { report, message: describeInvites(report) };
    },
    handoffUrl: (hubId, email, version) => handoffUrl(hubId, email, version),
    hubSignInUrl: (hubId) => hubSignInUrl(hubId),
    async legalSummaries(values) {
      return legalSummaries(values);
    },

    listStates: () => listStates(),
    searchJurisdictions: (params) => searchJurisdictions(params),
    suggestSlug: (params) => suggestSlug(params),
    checkSlug: (slug, state) => checkSlug(slug, state),

    listHubs: () => listHubs(),
    getHub: (hubId) => getHub(hubId),
    async hubDetail(hubId) {
      const hub = await getHub(hubId);
      return hub ? detailOf(hub) : null;
    },
    async planConfig(hubId, body) {
      const hub = await requireHub(hubId);
      const current = await hubConfigView(hub);
      const changes = changedFields(current, parseConfigPatch(body));
      if (Object.keys(changes).length > 0) await validateHubConfig(hub, changes);
      const before = Object.fromEntries(
        Object.keys(changes).map((k) => [k, (current as unknown as Record<string, unknown>)[k]]),
      );
      return { changes, before, needs_step_up: configChangeNeedsStepUp(changes) };
    },
    async applyConfig(hubId, requested, actor) {
      const hub = await requireHub(hubId);
      const changes = await withDerivedCode(hub, requested);
      const followOn = await updateHubConfig(hub, changes, actor);
      return { changes, follow_on: followOn, message: describeFollowOn(followOn) };
    },
    async updateHandover(hubId, body, actor) {
      const hub = await requireHub(hubId);
      refuseArchived(hub);
      const result = await updateHandover(hub, parseHandoverPatch(body), actor);
      return { result, message: describeFollowOn(result) };
    },
    async updateAiLimits(hubId, body, actor) {
      const hub = await requireHub(hubId);
      refuseArchived(hub);
      return updateHubAiLimits(hub, body, actor);
    },
    async planAdmins(hubId, body) {
      await requireHub(hubId);
      const next = parseAdminList(body);
      return { before: await hubAdmins(hubId), next };
    },
    async setAdmins(hubId, admins, actor) {
      await requireHub(hubId);
      await setHubAdmins(hubId, admins, actor);
    },
    /**
     * "Refresh samples" (2026-10-07): the daily sample refresh, now, for one
     * demo or beta hub, plus any template the hub lacks. Recorded like the
     * job's own run, in the hub's job_runs.
     */
    async refreshSamples(hubId) {
      const hub = await requireHub(hubId);
      refuseArchived(hub);
      if (!refreshesSamples(hub.mode)) {
        throw new ControlInputError("Samples are refreshed on demo and beta hubs only; this hub is in " + hub.mode + " mode.");
      }
      const row = await getHubBySlug(hubId);
      if (!row) throw new Error(`hub ${hubId} not found`);
      const settings = await fetchHubSettings(hubId);
      return withHubScope(row, settings, async () => {
        const started = new Date();
        const report = await refreshSamples({ now: started, addMissing: true });
        const run = describeJobRun("sample_refresh", { status: 200, body: report as unknown as Record<string, unknown> });
        if (run) await recordJobRun("sample_refresh", started, run, { ...report, trigger: "console" });
        // Titles beside the ids, filled with this hub's names (3b follow-up).
        return { refresh: report, titles: sampleTemplateTitles(sampleNames()) };
      });
    },
    async archive(hubId) {
      const hub = await requireHub(hubId);
      if (hub.archived_at) throw new ControlInputError("This hub is already archived.");
      await archiveHub(hub);
    },
    async unarchive(hubId) {
      await unarchiveHub(await requireHub(hubId));
    },
    async exportHub(hubId, actor) {
      await requireHub(hubId);
      return exportHubArchive(hubId, actor);
    },
    async hubAdminAudit(hubId, limit) {
      await requireHub(hubId);
      return listHubAdminAudit(hubId, limit);
    },

    dashboard: ({ fresh, now }) => hubDashboardSections({ fresh, now: new Date(now) }),

    catalog: () => catalogView(),
    approveEntry: (id, by, notes) => catalogChange(() => approveEntry(id, by, notes)),
    releaseApprove: (commit, entries) => releaseApproveEntries(commit, entries),
    signApproved: () => catalogChange(() => signApprovedEntries()),
    setRequired: (id, required) => catalogChange(() => setEntryRequired(id, required)),
    withdrawEntry: (id, by, notes) => catalogChange(() => withdrawEntry(id, by, notes)),

    feedbackInbox: (filter) => feedbackInbox(filter),
    feedbackCount: () => countReceived(),
    updateFeedback: (id, body) => updateFeedbackItem(id, body),
  };
}
