// The super admin's HTTP surface. Mounted only by ./index.ts, which hands a
// request here only when it arrived on the console hostname; every route
// checks that again (requireConsoleHost), so a mistake in the dispatch cannot
// expose this on a hub's hostname.
//
// Sign-in is a session cookie (HttpOnly, SameSite=Strict), never a token the
// page can read. Every write also needs the X-Civic-Console header, which a
// cross-site form cannot send. Destructive writes need a step-up code as
// well: `step_up_code` in the body, spent on use.

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { RESERVED_HUB_SLUG_PURPOSES, type HubMode } from "../models/hub.js";
import { PLUGINS_OWNER_NOTE } from "../shared/settingOwners.js";
import { PLUGIN_IDS } from "../models/hubSettings.js";
import { listAudit, listHubAdminAudit, recordAudit } from "./audit.js";
import { exportHubArchive } from "./hubExport.js";
import { listStates, searchJurisdictions, suggestSlug } from "./jurisdictions.js";
import { getHubBySlug } from "../db/hubs.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { withHubScope } from "../config/hubContext.js";
import { refreshSamples, type SampleRefreshReport } from "../services/sampleRefresh.js";
import { describeJobRun } from "../jobs/describe.js";
import { recordJobRun } from "../services/jobRuns.js";
import { kindsWithSamples, samplePreviews, sampleTemplateTitles } from "../services/sampleTemplates.js";
import { sampleNames } from "../services/sampleNames.js";
import { describeInvites } from "../services/adminInvite.js";
import { inviteAdmins, seedSampleInHub } from "./inHub.js";
import {
  CODE_SENT,
  ControlAuthError,
  SESSION_TTL_MS,
  consumeCode,
  createSession,
  requestCode,
  revokeSession,
  sessionFromToken,
  type ControlSession,
} from "./auth.js";
import {
  DEFAULT_INVITE_DAYS,
  EntitlementError,
  MAX_INVITE_DAYS,
  listEntitlements,
  mintInvite,
  parseMintInput,
  revokeEntitlement,
} from "./entitlements.js";
import {
  consoleAdminEmail,
  consoleHostname,
  isConsoleHost,
  isProductionDatabase,
  platformDomain,
  startHostname,
} from "./config.js";
import {
  ControlInputError,
  archiveHub,
  changedFields,
  configChangeNeedsStepUp,
  createHub,
  describeFollowOn,
  getHub,
  hubHandover,
  hubAdmins,
  hubConfigView,
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
  updateHubConfig,
  validateHubConfig,
  withDerivedCode,
  type ControlHub,
} from "./hubs.js";

const COOKIE = "civic_console";
const CSRF_HEADER = "x-civic-console";

/** The console creates any mode; demo is its default (Adam, 2026-09-26). */
const CONSOLE_CREATE_MODES: readonly HubMode[] = ["demo", "beta", "live"];

declare module "express-serve-static-core" {
  interface Locals {
    controlSession?: ControlSession;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function isHttps(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req: Request, res: Response): void {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function fail(res: Response, err: unknown): void {
  if (err instanceof ControlAuthError || err instanceof ControlInputError || err instanceof EntitlementError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Not a refusal we wrote: say so in words, and keep the details for the log.
  console.error("[control]", err);
  res.status(500).json({
    error: "Something went wrong on the server, and the change may not have been made. Reload the page to see what was saved; the server log has the details.",
  });
}

type Handler = (req: Request, res: Response) => Promise<void>;

function route(fn: Handler) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => fail(res, err));
  };
}

function requireConsoleHost(req: Request, res: Response, next: NextFunction): void {
  if (!isConsoleHost(req.headers.host)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
    res.status(403).json({ error: "Missing the console header." });
    return;
  }
  next();
}

async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await sessionFromToken(readCookie(req, COOKIE));
  if (!session) {
    res.status(401).json({ error: "Sign in to the console." });
    return;
  }
  res.locals.controlSession = session;
  next();
}

function actor(res: Response): string {
  return res.locals.controlSession!.email;
}

/** Spend the step-up code in the body, or answer 403 step_up_required. */
async function stepUp(req: Request, res: Response): Promise<boolean> {
  const code = (req.body as { step_up_code?: unknown })?.step_up_code;
  if (typeof code !== "string" || code.trim() === "") {
    res.status(403).json({ error: "step_up_required", message: "This change needs a fresh code." });
    return false;
  }
  await consumeCode(actor(res), "step_up", code);
  return true;
}

async function loadHub(req: Request, res: Response): Promise<ControlHub | null> {
  const hub = await getHub(String(req.params.id));
  if (!hub) res.status(404).json({ error: "No such hub." });
  return hub;
}

/**
 * "Refresh samples" (2026-10-07): the daily sample refresh, now, for one demo
 * hub, plus any template the hub lacks. Recorded like the job's own run, in
 * the hub's job_runs; no audit row (Adam).
 */
async function refreshSamplesInHub(hubId: string): Promise<{ refresh: SampleRefreshReport; titles: Record<string, string> }> {
  const row = await getHubBySlug(hubId);
  if (!row) throw new Error(`hub ${hubId} not found`);
  const settings = await fetchHubSettings(hubId);
  return withHubScope(row, settings, async () => {
    const started = new Date();
    const report = await refreshSamples({ now: started, addMissing: true });
    const run = describeJobRun("sample_refresh", { status: 200, body: report as unknown as Record<string, unknown> });
    if (run) await recordJobRun("sample_refresh", started, run, { ...report, trigger: "console" });
    // Titles beside the ids, filled with this hub's names, so the console
    // says what it added by name (3b follow-up).
    return { refresh: report, titles: sampleTemplateTitles(sampleNames()) };
  });
}

async function hubDetail(hub: ControlHub) {
  return {
    hub,
    config: await hubConfigView(hub),
    handover: await hubHandover(hub),
    plugins: await hubPlugins(hub.id),
    admins: await hubAdmins(hub.id),
  };
}

/** The action is done; record it. A failed record is reported, not hidden. */
async function audited(res: Response, entry: Parameters<typeof recordAudit>[0]): Promise<void> {
  try {
    await recordAudit(entry);
  } catch (err) {
    console.error("[control] AUDIT WRITE FAILED", entry, err);
    throw new Error(
      "The change was made, but it could not be recorded in the audit log. Check the database before doing anything else.",
    );
  }
}

export function controlRouter(): Router {
  const r = express.Router();
  r.use(requireConsoleHost);
  r.use(express.json({ limit: "64kb" }));
  r.use(requireCsrfHeader);

  // --- Session ---

  r.get("/control/session", route(async (req, res) => {
    const session = await sessionFromToken(readCookie(req, COOKIE));
    const admin = consoleAdminEmail();
    res.json({
      email: session?.email ?? null,
      operator_configured: admin.ok,
      console_hostname: consoleHostname(),
    });
  }));

  r.post("/control/auth/request-code", route(async (req, res) => {
    const message = await requestCode((req.body as { email?: unknown })?.email, "sign_in");
    res.json({ message });
  }));

  r.post("/control/auth/verify", route(async (req, res) => {
    const body = req.body as { email?: unknown; code?: unknown };
    const email = await consumeCode(body.email, "sign_in", body.code);
    const { token } = await createSession(email);
    res.locals.controlSession = { email, expires_at: "" };
    await audited(res, { actor: email, action: "console.sign_in" });
    setSessionCookie(req, res, token);
    res.json({ email });
  }));

  r.post("/control/auth/logout", route(async (req, res) => {
    const token = readCookie(req, COOKIE);
    const session = await sessionFromToken(token);
    await revokeSession(token);
    if (session) await audited(res, { actor: session.email, action: "console.sign_out" });
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }));

  // Everything below needs a session.
  r.use("/control", (req, res, next) => {
    requireSession(req, res, next).catch((err) => fail(res, err));
  });

  r.post("/control/auth/step-up/request-code", route(async (_req, res) => {
    await requestCode(actor(res), "step_up");
    res.json({ message: CODE_SENT });
  }));

  // --- What the create form needs to know ---

  r.get("/control/config", route(async (_req, res) => {
    const hubs = await listHubs();
    res.json({
      console_hostname: consoleHostname(),
      platform_domain: platformDomain(),
      reserved_slugs: RESERVED_HUB_SLUG_PURPOSES,
      plugin_ids: PLUGIN_IDS,
      // The create form disables "Start with sample content" for the rest.
      sample_kinds: kindsWithSamples(),
      production_database: isProductionDatabase(),
      hub_specific_env_vars: hubSpecificEnvVars(),
      create_refusal: productionCreateGuard(hubs.length),
      // The create form's preview: a sample card's first line, placeholders
      // and all, per "<kind>:<type>" — a card that will really be seeded
      // (review R21); the form fills them from what is typed.
      sample_previews: samplePreviews(),
    });
  }));

  // --- The jurisdiction reference list (read-only) ---

  // The state dropdown. Empty when the list has not been loaded; the form
  // then offers only "Other / not listed".
  r.get("/control/jurisdictions/states", route(async (_req, res) => {
    res.json({ states: await listStates() });
  }));

  // The type-ahead: ?state=va&type=town&q=flo. Each match names the hubs
  // already serving it (information, not a refusal).
  r.get("/control/jurisdictions", route(async (req, res) => {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    res.json({
      matches: await searchJurisdictions({
        state: str(req.query.state),
        type: str(req.query.type),
        q: str(req.query.q),
        limit: Number(req.query.limit) || undefined,
      }),
    });
  }));

  // The shortest free address: ?name=Floyd town&type=town&state=va.
  r.get("/control/slug-suggestion", route(async (req, res) => {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    res.json(await suggestSlug({ name: str(req.query.name), type: str(req.query.type) || null, state: str(req.query.state) || null }));
  }));

  // --- Hubs ---

  r.get("/control/hubs", route(async (_req, res) => {
    res.json({ hubs: await listHubs() });
  }));

  r.post("/control/hubs", route(async (req, res) => {
    const input = parseCreateInput((req.body ?? {}) as Record<string, unknown>);
    const { hub, settings } = await createHub(input, {
      allowedModes: CONSOLE_CREATE_MODES,
      updatedBy: `console:${actor(res)}`,
    });
    await audited(res, { actor: actor(res), action: "hub.create", hubId: hub.id, before: null, after: { hub, settings } });
    // "Start with sample content" (Phase 7). The hub exists either way: a
    // seed that fails is reported, and can be rerun with
    // scripts/seed-sample-content.ts (it is idempotent).
    let sample: unknown = null;
    if (input.sampleContent) {
      try {
        const report = await seedSampleInHub(hub.id);
        await audited(res, { actor: actor(res), action: "hub.sample_seed", hubId: hub.id, before: null, after: report });
        sample = report;
      } catch (err) {
        console.error(`[control] sample seed failed for ${hub.id}`, err);
        sample = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    // The first admin hears about it (review R38).
    const invites = await inviteAdmins(hub.id, input.admins);
    res.status(201).json({ ...(await hubDetail(hub)), sample_content: sample, invites, message: describeInvites(invites) });
  }));

  r.get("/control/hubs/:id", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (hub) res.json(await hubDetail(hub));
  }));

  r.patch("/control/hubs/:id", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    const before = await hubConfigView(hub);
    let changes = changedFields(before, parseConfigPatch((req.body ?? {}) as Record<string, unknown>));
    if (Object.keys(changes).length === 0) {
      res.json(await hubDetail(hub));
      return;
    }
    await validateHubConfig(hub, changes);
    if (configChangeNeedsStepUp(changes) && !(await stepUp(req, res))) return;
    changes = await withDerivedCode(hub, changes);
    const followOn = await updateHubConfig(hub, changes, actor(res));
    const priorValues = Object.fromEntries(
      Object.keys(changes).map((k) => [k, (before as unknown as Record<string, unknown>)[k]]),
    );
    await audited(res, {
      actor: actor(res),
      action: "hub.update",
      hubId: hub.id,
      before: priorValues,
      after: Object.keys(followOn.carried).length ? { ...changes, carried: followOn.carried } : changes,
    });
    res.json({ ...(await hubDetail((await getHub(hub.id))!)), follow_on: followOn, message: describeFollowOn(followOn) });
  }));

  // What residents see, while the hub is a demo (review R48). Refused once
  // it has left demo: then it is the hub's admins' (src/shared/settingOwners.ts).
  r.put("/control/hubs/:id/handover", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    if (hub.archived_at) throw new ControlInputError("This hub is archived.");
    const patch = parseHandoverPatch(req.body);
    const result = await updateHandover(hub, patch, actor(res));
    if (Object.keys(result.after).length > 0) {
      await audited(res, {
        actor: actor(res),
        action: "hub.handover",
        hubId: hub.id,
        before: result.before,
        after: Object.keys(result.carried).length ? { ...result.after, carried: result.carried } : result.after,
      });
    }
    res.json({ ...(await hubDetail((await getHub(hub.id))!)), follow_on: result, message: describeFollowOn(result) });
  }));

  // Plugin switches are the hub's admins' after create (review R10, Adam
  // 2026-10-08): the console shows them read-only. Answered rather than
  // removed, so an old page or script is told why.
  r.put("/control/hubs/:id/plugins", route(async () => {
    throw new ControlInputError(PLUGINS_OWNER_NOTE, 409);
  }));

  r.put("/control/hubs/:id/admins", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    const next = parseAdminList(req.body);
    const before = await hubAdmins(hub.id);
    if (JSON.stringify(before) === JSON.stringify(next)) {
      res.json(await hubDetail(hub));
      return;
    }
    // Any change to who runs a hub takes a fresh code, adding as well as
    // removing, as on the hub's own Admins & board page (review R52).
    if (!(await stepUp(req, res))) return;
    await setHubAdmins(hub.id, next, actor(res));
    await audited(res, { actor: actor(res), action: "hub.admins", hubId: hub.id, before, after: next });
    const invites = await inviteAdmins(hub.id, next.filter((e) => !before.includes(e)));
    res.json({ ...(await hubDetail(hub)), invites, message: describeInvites(invites) });
  }));

  // Demo hubs only: a beta or live hub never gets samples back.
  r.post("/control/hubs/:id/samples/refresh", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    if (hub.archived_at) throw new ControlInputError("This hub is archived.");
    if (hub.mode !== "demo") {
      throw new ControlInputError("Samples are refreshed on demo hubs only; this hub is in " + hub.mode + " mode.");
    }
    // Titles beside ids, so the console names what it added (3b follow-up).
    res.json(await refreshSamplesInHub(hub.id));
  }));

  r.post("/control/hubs/:id/archive", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    if (hub.archived_at) throw new ControlInputError("This hub is already archived.");
    if (!(await stepUp(req, res))) return;
    await archiveHub(hub);
    const after = (await getHub(hub.id))!;
    await audited(res, {
      actor: actor(res),
      action: "hub.archive",
      hubId: hub.id,
      before: { status: hub.status, archived_at: hub.archived_at },
      after: { status: after.status, archived_at: after.archived_at },
    });
    res.json(await hubDetail(after));
  }));

  r.post("/control/hubs/:id/unarchive", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    await unarchiveHub(hub);
    const after = (await getHub(hub.id))!;
    await audited(res, {
      actor: actor(res),
      action: "hub.unarchive",
      hubId: hub.id,
      before: { status: hub.status, archived_at: hub.archived_at },
      after: { status: after.status, archived_at: after.archived_at },
    });
    res.json(await hubDetail(after));
  }));

  // An export carries the hub's personal data off the platform: step-up,
  // and recorded before the link is handed over. The link lives ten
  // minutes; the object is swept after 24 hours (the audit row stays).
  r.post("/control/hubs/:id/export", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (!hub) return;
    if (!(await stepUp(req, res))) return;
    const result = await exportHubArchive(hub.id, actor(res));
    await audited(res, {
      actor: actor(res),
      action: "hub.export",
      hubId: hub.id,
      before: null,
      after: {
        object_key: result.object_key,
        size: result.size,
        rows: result.rows,
        images: result.images,
        fingerprint: result.fingerprint,
        format_version: result.format_version,
      },
    });
    res.json(result);
  }));

  // --- Invite codes (session 4b, Adam 2026-10-08) ---
  //
  // A code lets one person create one demo hub on the start page
  // (CIVIC_START_HOSTNAME). Shown once, at mint; stored hashed. Minting and
  // revoking are audited; neither takes step-up (a code grants a demo hub,
  // and revoking only takes a grant away).

  r.get("/control/invites", route(async (_req, res) => {
    res.json({
      invites: await listEntitlements(),
      start_hostname: startHostname(),
      default_days: DEFAULT_INVITE_DAYS,
      max_days: MAX_INVITE_DAYS,
    });
  }));

  r.post("/control/invites", route(async (req, res) => {
    const input = parseMintInput(req.body);
    const { code, entitlement } = await mintInvite(input, actor(res));
    await audited(res, {
      actor: actor(res),
      action: "invite.mint",
      before: null,
      after: {
        entitlement_id: entitlement.id,
        kind: entitlement.kind,
        quantity: entitlement.quantity,
        code_hint: entitlement.code_hint,
        note: entitlement.note,
        expires_at: entitlement.expires_at,
      },
    });
    res.status(201).json({ code, invite: entitlement, start_hostname: startHostname() });
  }));

  r.post("/control/invites/:id/revoke", route(async (req, res) => {
    const { before, after } = await revokeEntitlement(String(req.params.id), actor(res));
    await audited(res, {
      actor: actor(res),
      action: "invite.revoke",
      before: { entitlement_id: before.id, code_hint: before.code_hint, note: before.note, revoked_at: null },
      after: { entitlement_id: after.id, revoked_at: after.revoked_at },
    });
    res.json({ invites: await listEntitlements() });
  }));

  // --- Audit log ---

  r.get("/control/audit", route(async (req, res) => {
    const hubId = typeof req.query.hub === "string" && req.query.hub ? req.query.hub : undefined;
    res.json({ entries: await listAudit({ hubId, limit: Number(req.query.limit) || 100 }) });
  }));

  // What the hub's own admins did with a fresh code (Phase 7): read from the
  // hub's hub_admin_audit_log, nothing copied into control_audit_log.
  r.get("/control/hubs/:id/admin-audit", route(async (req, res) => {
    const hub = await loadHub(req, res);
    if (hub) res.json({ entries: await listHubAdminAudit(hub.id, Number(req.query.limit) || 100) });
  }));

  // Anything else on the console host is not a hub page.
  r.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return r;
}
