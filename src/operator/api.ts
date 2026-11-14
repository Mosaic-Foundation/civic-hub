// The operator API: everything the console asks of a hub deployment (the
// console split, 2026-11-10; Seam-Audit-2026-11-10.md).
//
// The console (Mosaic-Foundation/mosaic-console) holds the operator's identity: sign-in,
// fresh codes, its own audit log, invite codes and the catalog signing key.
// Everything about hubs and their data is the hub's, and the console reaches
// it only through this interface: localOperator() (./local.ts), served over
// HTTPS at /operator/rpc/<method> (./router.ts) with CIVIC_OPERATOR_TOKEN.
//
// Rules for a method here: arguments and results are plain JSON (no Dates,
// Maps, class instances); a refusal is a CivicError (status, code, message),
// which crosses HTTP as { error, code } and comes back as a CivicError. The
// console decides policy that is about the operator (fresh codes, audit
// rows); the hub decides everything about the hub (validation, writes).
//
// The console keeps a copy of this contract with its types inlined: a change
// here is a change to the console's client too.

import type { ControlHub, CreateHubInput, FollowOn, HandoverResult, HandoverView, HubAiLimitsView, HubConfigView, PluginState } from "./hubs.js";
import type { JurisdictionMatch, Jurisdiction, SlugSuggestion } from "./jurisdictions.js";
import type { CatalogView, ReleaseOutcome, ReleasePlanItem, ReleaseRequest } from "./pluginCatalog.js";
import type { Signature } from "../shared/catalogSignature.js";
import type { CatalogRow } from "../db/pluginCatalog.js";
import type { InboxView, FeedbackUpdateResult } from "./platformFeedback.js";
import type { HubExportResult } from "./hubExport.js";
import type { HubAdminAuditRow } from "./adminAudit.js";
import type { SampleSeedReport } from "../services/sampleSeed.js";
import type { StarterOutcome } from "../services/starterWordcloud.js";
import type { InviteReport } from "../services/adminInvite.js";
import type { SampleRefreshReport } from "../services/sampleRefresh.js";
import type { HubMode } from "../models/hub.js";
import type { SectionResult } from "../shared/dashboardRun.js";

export type {
  CatalogRow,
  CatalogView,
  ControlHub,
  CreateHubInput,
  FeedbackUpdateResult,
  FollowOn,
  HandoverResult,
  HubAdminAuditRow,
  HubConfigView,
  HubExportResult,
  HubMode,
  InboxView,
  InviteReport,
  Jurisdiction,
  JurisdictionMatch,
  ReleaseOutcome,
  ReleasePlanItem,
  ReleaseRequest,
  SampleRefreshReport,
  SampleSeedReport,
  SlugSuggestion,
  StarterOutcome,
};

/** A hub as the console's hub page shows it. */
export interface HubDetail {
  hub: ControlHub;
  config: HubConfigView;
  handover: HandoverView;
  plugins: PluginState[];
  admins: string[];
  ai_limits: HubAiLimitsView;
  samples: { auto_refresh: boolean };
}

/** What the console's Create hub form needs to know. */
export interface CreateInfo {
  platform_domain: string | null;
  reserved_slugs: Record<string, string>;
  plugin_ids: readonly string[];
  /** What each plugin is called, by id. */
  plugin_names: Record<string, string>;
  /**
   * Whether each plugin starts on when the form leaves it alone (all on but
   * the Fediverse account, src/shared/hubFeatures.ts). A console that reads
   * it ticks its boxes to match; one that doesn't ticks them all.
   */
  plugin_defaults?: Record<string, boolean>;
  sample_kinds: string[];
  production_database: boolean;
  hub_specific_env_vars: string[];
  create_refusal: string | null;
  sample_previews: Record<string, { pill: string; title: string } | null>;
}

/** An admin invite's outcome, with the sentence the console shows. */
export interface InviteOutcome {
  report: InviteReport;
  message: string | null;
}

/** A config change, checked: what changes, the values before, and whether it takes a fresh code. */
export interface ConfigPlan {
  changes: Partial<HubConfigView>;
  /** The values of the changed fields before. */
  before: Record<string, unknown>;
  needs_step_up: boolean;
}

export interface OperatorApi {
  // --- Hub creation ---
  createInfo(): Promise<CreateInfo>;
  /** Normalise a create form's fields; refuses malformed input. */
  parseCreate(body: Record<string, unknown>): Promise<CreateHubInput>;
  createHub(input: CreateHubInput, opts: { allowedModes: readonly HubMode[]; updatedBy: string }): Promise<{ hub: ControlHub; settings: Record<string, string> }>;
  seedSamples(hubId: string): Promise<SampleSeedReport>;
  /** Never throws: a failure comes back as { error }. */
  addStarterWordcloud(hubId: string, by: string): Promise<StarterOutcome | { error: string }>;
  /** Never throws: an address that could not be emailed is in report.not_sent. */
  inviteAdmins(hubId: string, emails: readonly string[]): Promise<InviteOutcome>;
  /** Where to send the person who just created a hub: its front page, signed in. */
  handoffUrl(hubId: string, email: string, agreedLegalVersion?: string): Promise<string>;
  hubSignInUrl(hubId: string): Promise<string>;
  legalSummaries(values: Record<string, string>): Promise<Array<{ title: string; path: string; summary: string }>>;

  // --- Jurisdictions and addresses ---
  listStates(): Promise<Jurisdiction[]>;
  searchJurisdictions(params: { state: string; type: string; q: string; limit?: number }): Promise<JurisdictionMatch[]>;
  suggestSlug(params: { name: string; type: string | null; state: string | null }): Promise<SlugSuggestion>;
  checkSlug(slug: string, state: string | null): Promise<{ available: boolean; reason: "taken" | "reserved" | "invalid" | null; suggestion: string | null }>;

  // --- Hubs ---
  listHubs(): Promise<ControlHub[]>;
  getHub(hubId: string): Promise<ControlHub | null>;
  hubDetail(hubId: string): Promise<HubDetail | null>;
  /** Check a config patch; refuses an invalid one. Nothing is written. */
  planConfig(hubId: string, body: Record<string, unknown>): Promise<ConfigPlan>;
  applyConfig(hubId: string, changes: Partial<HubConfigView>, actor: string): Promise<{ changes: Partial<HubConfigView>; follow_on: FollowOn; message: string | null }>;
  updateHandover(hubId: string, body: unknown, actor: string): Promise<{ result: HandoverResult; message: string | null }>;
  updateAiLimits(hubId: string, body: unknown, actor: string): Promise<{ before: unknown; after: unknown }>;
  /** The roster asked for, checked, beside the current one. */
  planAdmins(hubId: string, body: unknown): Promise<{ before: string[]; next: string[] }>;
  setAdmins(hubId: string, admins: readonly string[], actor: string): Promise<void>;
  refreshSamples(hubId: string): Promise<{ refresh: SampleRefreshReport; titles: Record<string, string> }>;
  archive(hubId: string): Promise<void>;
  unarchive(hubId: string): Promise<void>;
  exportHub(hubId: string, actor: string): Promise<HubExportResult>;
  hubAdminAudit(hubId: string, limit: number): Promise<HubAdminAuditRow[]>;

  // --- Dashboard ---
  /** The hub's dashboard sections (now: ISO time). */
  dashboard(opts: { fresh: boolean; now: string }): Promise<SectionResult[]>;

  // --- Plugin catalog (ADR-014, ADR-015) ---
  // The console signs; the hub stores a signature
  // only if it verifies against a key the deployment trusts.
  catalog(): Promise<CatalogView>;
  /** Approve with the console's signature over the row (null: the console has no key; refused once signatures are required). */
  approveEntry(id: string, by: string, notes: string | null, signature: Signature | null): Promise<{ before: CatalogRow; after: CatalogRow }>;
  /** Which of a release's entries it may approve (first-party, pending, the fingerprint CI tested), and why not the rest. */
  releasePlan(entries: readonly ReleaseRequest[]): Promise<ReleasePlanItem[]>;
  /** Store the console's signatures for approved entries; returns what was stored. */
  storeSignatures(items: ReadonlyArray<{ id: string } & Signature>): Promise<Array<Pick<CatalogRow, "id" | "package" | "version" | "hash">>>;
  setRequired(id: string, required: boolean): Promise<{ before: CatalogRow; after: CatalogRow; moved: number }>;
  withdrawEntry(id: string, by: string, notes: string | null): Promise<{ before: CatalogRow; after: CatalogRow }>;

  // --- Civic.Social's feedback inbox ---
  feedbackInbox(filter: { stream?: unknown; status?: unknown }): Promise<InboxView>;
  feedbackCount(): Promise<number>;
  updateFeedback(id: string, body: unknown): Promise<FeedbackUpdateResult | null>;
}

/** Every method's name: the HTTP router's dispatch list and the client's. */
export const OPERATOR_METHODS = [
  "createInfo",
  "parseCreate",
  "createHub",
  "seedSamples",
  "addStarterWordcloud",
  "inviteAdmins",
  "handoffUrl",
  "hubSignInUrl",
  "legalSummaries",
  "listStates",
  "searchJurisdictions",
  "suggestSlug",
  "checkSlug",
  "listHubs",
  "getHub",
  "hubDetail",
  "planConfig",
  "applyConfig",
  "updateHandover",
  "updateAiLimits",
  "planAdmins",
  "setAdmins",
  "refreshSamples",
  "archive",
  "unarchive",
  "exportHub",
  "hubAdminAudit",
  "dashboard",
  "catalog",
  "approveEntry",
  "releasePlan",
  "storeSignatures",
  "setRequired",
  "withdrawEntry",
  "feedbackInbox",
  "feedbackCount",
  "updateFeedback",
] as const satisfies ReadonlyArray<keyof OperatorApi>;

export type OperatorMethod = (typeof OPERATOR_METHODS)[number];

// Every method of OperatorApi is listed above (a compile error names any that is not).
type Unlisted = Exclude<keyof OperatorApi, OperatorMethod>;
export const ALL_METHODS_LISTED: [Unlisted] extends [never] ? true : Unlisted = true;
