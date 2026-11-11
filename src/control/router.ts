// The super admin's HTTP surface. Mounted only by ./index.ts, which hands a
// request here only when it arrived on the console hostname; every route
// checks that again (requireConsoleHost), so a mistake in the dispatch cannot
// expose this on a hub's hostname.
//
// Sign-in is a session cookie (HttpOnly, SameSite=Strict), never a token the
// page can read. Every write also needs the X-Civic-Console header, which a
// cross-site form cannot send. Destructive writes need a step-up code as
// well: `step_up_code` in the body, spent on use.

import { env } from "../config/env.js";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { clientIp } from "../utils/clientIp.js";
import { CivicError } from "../errors/index.js";
import { logUnexpected, newRef } from "../http/route.js";
import { flushErrors } from "../utils/errorTracking.js";
import { PLUGINS_OWNER_NOTE } from "../shared/settingOwners.js";
import { listAudit, recordAudit } from "./audit.js";
import { gatherDashboard } from "./dashboard/registry.js";
import type { ControlHub, HubMode, OperatorApi } from "../operator/api.js";
import {
  CODE_SENT,
  ControlAuthError,
  SESSION_TTL_MS,
  confirmCatalogWindow,
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
  INVITE_REFUSED,
  MAX_INVITE_DAYS,
  checkInviteCode,
  createInviteLink,
  listEntitlements,
  mintInvite,
  parseMintInput,
  parseSendInvite,
  revokeEntitlement,
} from "./entitlements.js";
import { renderInviteEmail } from "./inviteEmail.js";
import { mailConfigured, sendEmail, unsentReason } from "../utils/email.js";
import { consoleAdminEmail, consoleHostname, isConsoleHost, startHostname } from "./config.js";
import { ControlInputError } from "./errors.js";
import { spaceTypeView } from "../shared/spaceTypes.js";
import { isReleaseAuthorized, parseReleaseApproval } from "./releaseAuth.js";
import { consoleKey, signEntry } from "./catalogKey.js";
import { releaseApprover } from "../shared/firstParty.js";
import type { ReleaseOutcome } from "../operator/api.js";

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
  return req.secure || req.headers["x-forwarded-proto"] === "https" || env.NODE_ENV === "production";
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

/**
 * The console's error answer, in the hub's shape ({ error, code }; src/errors/).
 * A refusal answers its own status; anything else is logged in full with a
 * reference (logUnexpected) and answered in words, with that reference.
 */
async function fail(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof CivicError && err.status < 500) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const ref = newRef();
  const status = err instanceof CivicError ? err.status : 500;
  logUnexpected(req, err, status, ref, !(err instanceof CivicError));
  // Wait for error tracking's send (at most 2 s): see sendError() in src/http/route.ts.
  await flushErrors();
  res.status(status).json({
    error: `Something went wrong on the server, and the change may not have been made. Reload the page to see what was saved. (Reference ${ref})`,
    code: err instanceof CivicError ? err.code : "internal_error",
    ref,
  });
}

type Handler = (req: Request, res: Response) => Promise<void>;

function route(fn: Handler) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => fail(req, res, err));
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
  await consumeCode(actor(res), "step_up", code, clientIp(req), (req.body as { tz?: unknown })?.tz);
  return true;
}

/**
 * A guarded action's confirmation (ADR-015, widened in the console slice,
 * 2026-11-10): within ten minutes of a fresh code entered for one, on the
 * same session, none is needed; otherwise the code in the body, which opens
 * the window. Covers the catalog's actions, a hostname change or suspension,
 * a hub's admins, and archiving a hub. An export always takes its own code
 * (stepUp): personal data leaves the platform. Says how it was confirmed, for
 * the action's own audit row, or false when the code is still to come.
 * (The session's column is still `catalog_confirmed_until`: no migration.)
 */
async function windowedStepUp(req: Request, res: Response): Promise<"code" | "window" | false> {
  const until = res.locals.controlSession?.catalog_confirmed_until;
  if (until && Date.parse(until) > Date.now()) return "window";
  if (!(await stepUp(req, res))) return false;
  res.locals.controlSession!.catalog_confirmed_until = await confirmCatalogWindow(readCookie(req, COOKIE));
  return "code";
}

/**
 * The catalog view, with until when this session's catalog actions need no
 * code, and the signing state as the console sees it: its own key (the hub
 * holds only public halves; the console split, step 2), and how many
 * approved entries are not signed with it.
 */
async function catalogFor(op: OperatorApi, res: Response) {
  const until = res.locals.controlSession?.catalog_confirmed_until ?? null;
  const view = await op.catalog();
  const { key, problem } = consoleKey();
  const notTrusted =
    key && view.signing.key && view.signing.key.id !== key.id
      ? `This console signs with ${key.id}, but the hub deployment's current key is ${view.signing.key.id}: set its CIVIC_CATALOG_PUBLIC_KEY to this console's key.`
      : null;
  return {
    ...view,
    signing: {
      ...view.signing,
      key: key ? { id: key.id, public_key: key.publicKey } : null,
      problem: problem ?? notTrusted ?? view.signing.problem,
      unsigned: view.entries.filter((e) => e.status === "approved" && (!key || e.signature_key !== key.id || !e.signed)).length,
    },
    confirmed_until: until && Date.parse(until) > Date.now() ? until : null,
  };
}

/** The console's signature over a catalog entry, read from the hub; null without a key or without the entry. */
async function signatureFor(op: OperatorApi, id: string) {
  const entry = (await op.catalog()).entries.find((e) => e.id === id);
  return entry ? signEntry(entry) : null;
}

async function loadHub(op: OperatorApi, req: Request, res: Response): Promise<ControlHub | null> {
  const hub = await op.getHub(String(req.params.id));
  if (!hub) res.status(404).json({ error: "No such hub." });
  return hub;
}

/** A hub's page, which has to exist: it was just read or changed. */
async function detail(op: OperatorApi, hubId: string) {
  const d = await op.hubDetail(hubId);
  if (!d) throw new Error(`hub ${hubId} not found on read-back`);
  return d;
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

/** An optional note on a catalog decision, at most 1000 characters. */
function catalogNotes(body: unknown): string | null {
  const v = (body as { notes?: unknown } | undefined)?.notes;
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 1000) throw new ControlInputError("A note is text, at most 1000 characters.");
  return v.trim();
}

export function controlRouter(op: OperatorApi): Router {
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
      // What a space is called, for the console's headings (the space-type
      // record, src/shared/spaceTypes.ts): read before signing in.
      space_type: spaceTypeView(),
    });
  }));

  r.post("/control/auth/request-code", route(async (req, res) => {
    const body = req.body as { email?: unknown; tz?: unknown };
    const message = await requestCode(body?.email, "sign_in", clientIp(req), body?.tz);
    res.json({ message });
  }));

  r.post("/control/auth/verify", route(async (req, res) => {
    const body = req.body as { email?: unknown; code?: unknown; tz?: unknown };
    const email = await consumeCode(body.email, "sign_in", body.code, clientIp(req), body.tz);
    const { token } = await createSession(email);
    res.locals.controlSession = { email, expires_at: "", catalog_confirmed_until: null };
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

  // A release's approval of first-party entries CI proved (ADR-015
  // amendment): scripts/release.sh with CIVIC_RELEASE_SECRET, not a session.
  // The server signs, as the console's Approve does; the key never leaves it.
  r.post("/control/plugins/release-approve", route(async (req, res) => {
    if (!isReleaseAuthorized(req.headers.authorization)) {
      res.status(401).json({ error: "Not a release." });
      return;
    }
    const { commit, entries } = parseReleaseApproval(req.body);
    // The hub says which entries a release may approve; the console signs
    // each and approves it as its Approve does, by release@<commit>.
    const outcomes: ReleaseOutcome[] = [];
    for (const item of await op.releasePlan(entries)) {
      if (item.result === "pending") {
        outcomes.push(item);
        continue;
      }
      try {
        const { after } = await op.approveEntry(
          item.row.id,
          releaseApprover(commit),
          `Approved by release at ${commit}: CI green on that commit, fingerprint matched.`,
          signEntry(item.row),
        );
        outcomes.push({ package: item.package, version: item.version, result: "approved", id: after.id, signature_key: after.signature_key });
      } catch (err) {
        if (!(err instanceof CivicError) || err.status !== 409) throw err;
        outcomes.push({ package: item.package, version: item.version, result: "pending", reason: err.message });
      }
    }
    for (const o of outcomes) {
      await audited(res, {
        actor: `release@${commit}`,
        action: o.result === "approved" ? "plugin.approve" : "plugin.release_pending",
        hubId: null,
        before: null,
        after: { ...o, commit, confirmed: "release" },
      });
    }
    res.json({ commit, entries: outcomes });
  }));

  // Everything below needs a session.
  r.use("/control", (req, res, next) => {
    requireSession(req, res, next).catch((err) => fail(req, res, err));
  });

  r.post("/control/auth/step-up/request-code", route(async (req, res) => {
    await requestCode(actor(res), "step_up", clientIp(req), (req.body as { tz?: unknown })?.tz);
    res.json({ message: CODE_SENT });
  }));

  // --- What the create form needs to know ---

  r.get("/control/config", route(async (_req, res) => {
    const info = await op.createInfo();
    res.json({
      console_hostname: consoleHostname(),
      platform_domain: info.platform_domain,
      reserved_slugs: info.reserved_slugs,
      plugin_ids: info.plugin_ids,
      // The create form disables "Start with sample content" for the rest.
      sample_kinds: info.sample_kinds,
      production_database: info.production_database,
      hub_specific_env_vars: info.hub_specific_env_vars,
      create_refusal: info.create_refusal,
      // The create form's preview: a sample card's first line, placeholders
      // and all, per "<kind>:<type>" — a card that will really be seeded
      // (review R21); the form fills them from what is typed.
      sample_previews: info.sample_previews,
    });
  }));

  // --- The jurisdiction reference list (read-only) ---

  // The state dropdown. Empty when the list has not been loaded; the form
  // then offers only "Other / not listed".
  r.get("/control/jurisdictions/states", route(async (_req, res) => {
    res.json({ states: await op.listStates() });
  }));

  // The type-ahead: ?state=va&type=town&q=flo. Each match names the hubs
  // already serving it (information, not a refusal).
  r.get("/control/jurisdictions", route(async (req, res) => {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    res.json({
      matches: await op.searchJurisdictions({
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
    res.json(await op.suggestSlug({ name: str(req.query.name), type: str(req.query.type) || null, state: str(req.query.state) || null }));
  }));

  // --- The Dashboard (the dashboard slice): every section's loader at once ---

  // ?fresh=1 is the page's Refresh button: skip the one-minute caches.
  r.get("/control/dashboard", route(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await gatherDashboard(op, { fresh: req.query.fresh === "1" }));
  }));

  // --- Hubs ---

  r.get("/control/hubs", route(async (_req, res) => {
    res.json({ hubs: await op.listHubs() });
  }));

  r.post("/control/hubs", route(async (req, res) => {
    const input = await op.parseCreate((req.body ?? {}) as Record<string, unknown>);
    const { hub, settings } = await op.createHub(input, {
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
        const report = await op.seedSamples(hub.id);
        await audited(res, { actor: actor(res), action: "hub.sample_seed", hubId: hub.id, before: null, after: report });
        sample = report;
      } catch (err) {
        console.error(`[control] sample seed failed for ${hub.id}`, err);
        sample = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    const starter = await op.addStarterWordcloud(hub.id, `console:${actor(res)}`);
    // The first admin hears about it (review R38).
    const invites = await op.inviteAdmins(hub.id, input.admins);
    res.status(201).json({
      ...(await detail(op, hub.id)),
      sample_content: sample,
      starter_wordcloud: starter,
      invites: invites.report,
      message: invites.message,
    });
  }));

  r.get("/control/hubs/:id", route(async (req, res) => {
    const d = await op.hubDetail(String(req.params.id));
    if (!d) res.status(404).json({ error: "No such hub." });
    else res.json(d);
  }));

  r.patch("/control/hubs/:id", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    const plan = await op.planConfig(hub.id, (req.body ?? {}) as Record<string, unknown>);
    if (Object.keys(plan.changes).length === 0) {
      res.json(await detail(op, hub.id));
      return;
    }
    let confirmed: "code" | "window" | null = null;
    if (plan.needs_step_up) {
      const how = await windowedStepUp(req, res);
      if (!how) return;
      confirmed = how;
    }
    const { changes, follow_on: followOn, message } = await op.applyConfig(hub.id, plan.changes, actor(res));
    await audited(res, {
      actor: actor(res),
      action: "hub.update",
      hubId: hub.id,
      before: plan.before,
      after: {
        ...(Object.keys(followOn.carried).length ? { ...changes, carried: followOn.carried } : changes),
        ...(confirmed ? { confirmed } : {}),
      },
    });
    res.json({ ...(await detail(op, hub.id)), follow_on: followOn, message });
  }));

  // What residents see, while the hub is a demo (review R48). Refused once
  // it has left demo: then it is the hub's admins' (src/shared/settingOwners.ts).
  r.put("/control/hubs/:id/handover", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    const { result, message } = await op.updateHandover(hub.id, req.body, actor(res));
    if (Object.keys(result.after).length > 0) {
      await audited(res, {
        actor: actor(res),
        action: "hub.handover",
        hubId: hub.id,
        before: result.before,
        after: Object.keys(result.carried).length ? { ...result.after, carried: result.carried } : result.after,
      });
    }
    res.json({ ...(await detail(op, hub.id)), follow_on: result, message });
  }));

  // AI limits (Audit 2, A6): the operator's overrides of the defaults, at any
  // time. Not destructive, so no step-up; audited.
  r.put("/control/hubs/:id/ai-limits", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    const result = await op.updateAiLimits(hub.id, req.body, actor(res));
    await audited(res, { actor: actor(res), action: "hub.ai_limits", hubId: hub.id, before: result.before, after: result.after });
    res.json(await detail(op, hub.id));
  }));

  // Plugin switches are the hub's admins' after create (review R10, Adam
  // 2026-10-08): the console shows them read-only. Answered rather than
  // removed, so an old page or script is told why.
  r.put("/control/hubs/:id/plugins", route(async () => {
    throw new ControlInputError(PLUGINS_OWNER_NOTE, 409);
  }));

  r.put("/control/hubs/:id/admins", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    const { before, next } = await op.planAdmins(hub.id, req.body);
    if (JSON.stringify(before) === JSON.stringify(next)) {
      res.json(await detail(op, hub.id));
      return;
    }
    // Any change to who runs a hub takes a fresh code, adding as well as
    // removing, as on the hub's own Admins page (review R52).
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    await op.setAdmins(hub.id, next, actor(res));
    await audited(res, { actor: actor(res), action: "hub.admins", hubId: hub.id, before, after: next });
    const invites = await op.inviteAdmins(hub.id, next.filter((e) => !before.includes(e)));
    res.json({ ...(await detail(op, hub.id)), invites: invites.report, message: invites.message });
  }));

  // Demo and beta hubs only (the hub refuses the rest): a live hub never gets samples back.
  r.post("/control/hubs/:id/samples/refresh", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    // Titles beside ids, so the console names what it added (3b follow-up).
    res.json(await op.refreshSamples(hub.id));
  }));

  r.post("/control/hubs/:id/archive", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    if (hub.archived_at) throw new ControlInputError("This hub is already archived.");
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    await op.archive(hub.id);
    const after = await detail(op, hub.id);
    await audited(res, {
      actor: actor(res),
      action: "hub.archive",
      hubId: hub.id,
      before: { status: hub.status, archived_at: hub.archived_at },
      after: { status: after.hub.status, archived_at: after.hub.archived_at, confirmed },
    });
    res.json(after);
  }));

  r.post("/control/hubs/:id/unarchive", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    await op.unarchive(hub.id);
    const after = await detail(op, hub.id);
    await audited(res, {
      actor: actor(res),
      action: "hub.unarchive",
      hubId: hub.id,
      before: { status: hub.status, archived_at: hub.archived_at },
      after: { status: after.hub.status, archived_at: after.hub.archived_at },
    });
    res.json(after);
  }));

  // An export carries the hub's personal data off the platform: step-up,
  // and recorded before the link is handed over. The link lives ten
  // minutes; the object is swept after 24 hours (the audit row stays).
  r.post("/control/hubs/:id/export", route(async (req, res) => {
    const hub = await loadHub(op, req, res);
    if (!hub) return;
    if (!(await stepUp(req, res))) return;
    const result = await op.exportHub(hub.id, actor(res));
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

  // The minted code comes back from the console's screen, the only place it
  // exists: the server keeps its hash, so it can check the two belong together.
  r.post("/control/invites/:id/send", route(async (req, res) => {
    const { email, code } = parseSendInvite(req.body);
    const host = startHostname();
    if (!host) throw new ControlInputError("No start page is configured on this deployment, so the code cannot be used yet.", 409);
    const entitlement = await checkInviteCode(code);
    if (entitlement.id !== String(req.params.id)) throw new EntitlementError(INVITE_REFUSED, 403);
    const link = await createInviteLink(entitlement, email);
    const result = await sendEmail({ to: email, ...renderInviteEmail({ startHost: host, linkToken: link.token, email, expiresAt: link.expiresAt }) });
    if (!result.sent) {
      console.warn(`[control] invite email NOT sent (${unsentReason(result)}).`);
      // As the other flows: with no mailer at all (local development) it counts as sent.
      if (mailConfigured()) {
        throw new ControlInputError("The email could not be sent. The code still works: copy it and send it yourself.", 502);
      }
    }
    await audited(res, {
      actor: actor(res),
      action: "invite.send",
      before: null,
      after: { entitlement_id: entitlement.id, code_hint: entitlement.code_hint, sent_to: email },
    });
    res.json({ sent_to: email });
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
    const hub = await loadHub(op, req, res);
    if (hub) res.json({ entries: await op.hubAdminAudit(hub.id, Number(req.query.limit) || 100) });
  }));

  // Civic.Social's feedback inbox, across hubs (feedback routing): software
  // reports and hub admins' messages, grouped by likely duplicates.
  r.get("/control/feedback", route(async (req, res) => {
    res.json(await op.feedbackInbox({ stream: req.query.stream, status: req.query.status }));
  }));

  // The nav's count: items Civic.Social has not looked at yet.
  r.get("/control/feedback/count", route(async (_req, res) => {
    res.json({ received: await op.feedbackCount() });
  }));

  // Status (flows back to the hub's badge) and the GitHub issue link. Fixed,
  // for a consenting sender, emails them once. The audit row carries the
  // status and link only, never the sender's address.
  r.patch("/control/feedback/:id", route(async (req, res) => {
    const result = await op.updateFeedback(String(req.params.id), req.body);
    if (!result) {
      res.status(404).json({ error: "not_found", message: "No such feedback item." });
      return;
    }
    await audited(res, {
      actor: actor(res),
      action: "feedback.update",
      hubId: result.item.source_hub_id,
      before: { id: result.before.id, status: result.before.status, github_issue_url: result.before.github_issue_url },
      after: {
        id: result.item.id,
        status: result.item.status,
        github_issue_url: result.item.github_issue_url,
        ...(result.sender_told ? { sender_told: result.sender_told.sent } : {}),
      },
    });
    res.json(result);
  }));

  // The plugin catalog (ADR-014): every entry, with its grant in plain words
  // and whether this deployment's files match it; what the deployment mounts.
  r.get("/control/plugins", route(async (_req, res) => {
    res.json(await catalogFor(op, res));
  }));

  // Approving a catalog entry lets every hub on this deployment run that
  // exact code: a fresh code, and an audit row with the hash.
  r.post("/control/plugins/:id/approve", route(async (req, res) => {
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    const notes = catalogNotes(req.body);
    const { before, after } = await op.approveEntry(String(req.params.id), actor(res), notes, await signatureFor(op, String(req.params.id)));
    await audited(res, {
      actor: actor(res),
      action: "plugin.approve",
      hubId: null,
      before: { id: before.id, status: before.status },
      after: { id: after.id, package: after.package, version: after.version, hash: after.hash, status: after.status, signature_key: after.signature_key, confirmed },
    });
    res.json(await catalogFor(op, res));
  }));

  // Signing the entries approved before signatures (and every entry again
  // after the key is rotated): a fresh code, and an audit row listing them.
  r.post("/control/plugins/sign", route(async (req, res) => {
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    const { key, problem } = consoleKey();
    if (!key) {
      throw new ControlInputError(`This console has no catalog key to sign with (CIVIC_CATALOG_SIGNING_KEY${problem ? `: ${problem}` : " is not set"}).`, 409);
    }
    // Every approved entry not signed by this key: the rows approved before
    // signatures, and every row again after a rotation.
    const toSign = (await op.catalog()).entries.filter((e) => e.status === "approved" && (e.signature_key !== key.id || !e.signed));
    const signed = await op.storeSignatures(toSign.map((e) => ({ id: e.id, ...signEntry(e)! })));
    await audited(res, {
      actor: actor(res),
      action: "plugin.sign",
      hubId: null,
      before: null,
      after: { key: key.id, entries: signed, confirmed },
    });
    res.json(await catalogFor(op, res));
  }));

  // Marking a version required moves every hub on an older one to it, without
  // asking their admins: a fresh code, audited.
  r.post("/control/plugins/:id/required", route(async (req, res) => {
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    const required = (req.body as { required?: unknown } | undefined)?.required;
    if (typeof required !== "boolean") throw new ControlInputError('Send { "required": true } or { "required": false }.', 400);
    const { before, after, moved } = await op.setRequired(String(req.params.id), required);
    await audited(res, {
      actor: actor(res),
      action: "plugin.required",
      hubId: null,
      before: { id: before.id, required: before.required },
      after: { id: after.id, package: after.package, version: after.version, required: after.required, hubs_moved: moved, confirmed },
    });
    res.json(await catalogFor(op, res));
  }));

  // Withdrawing stops every server mounting that version within a minute.
  r.post("/control/plugins/:id/withdraw", route(async (req, res) => {
    const confirmed = await windowedStepUp(req, res);
    if (!confirmed) return;
    const notes = catalogNotes(req.body);
    const { before, after } = await op.withdrawEntry(String(req.params.id), actor(res), notes);
    await audited(res, {
      actor: actor(res),
      action: "plugin.withdraw",
      hubId: null,
      before: { id: before.id, status: before.status },
      after: { id: after.id, package: after.package, version: after.version, hash: after.hash, status: after.status, confirmed },
    });
    res.json(await catalogFor(op, res));
  }));

  // Anything else on the console host is not a hub page.
  r.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return r;
}
