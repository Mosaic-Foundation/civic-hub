// The start page's HTTP surface (session 4b, Adam 2026-10-08): a person
// given an invite code creates their own demo hub and lands in it as its
// admin, signed in, without the console.
//
// Mounted only by ./index.ts, for a request on CIVIC_START_HOSTNAME; every
// route checks the hostname again (requireStartHost), as the console's do,
// so a mistake in the dispatch cannot expose this on a hub's or the
// console's hostname.
//
//   POST /start/invite        the invite code → a start session (cookie)
//   POST /start/request-code  an emailed code to the address given
//   POST /start/verify        the emailed code → the session is that address's
//   GET  /start/session       which step the page is on
//   GET  /start/config, /start/jurisdictions…, /start/slug-suggestion
//                             what the form needs (signed in)
//   POST /start/hubs          create the hub → { redirect } to the hub, signed in
//   POST /start/leave         end the session
//
// The code is spent only once the hub exists (./entitlements.ts: claim,
// create, redeem; a failed create releases the claim). Every invalid, used,
// expired or revoked code gets INVITE_REFUSED. Each step is rate-limited by
// IP, and code requests by address too (./startAuth.ts). Redeeming and
// creating are audited in control_audit_log, with the creator as the actor.
//
// The session cookie is HttpOnly and SameSite=Strict; every write also needs
// the X-Civic-Start header, which a cross-site form cannot send.

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { recordAudit } from "./audit.js";
import { consoleAdminEmail, consoleHostname, isStartHost, startHubDomain } from "./config.js";
import {
  EntitlementError,
  INVITE_REFUSED,
  checkInviteCode,
  claimEntitlement,
  entitlementStillUsable,
  redeemEntitlement,
  releaseClaim,
} from "./entitlements.js";
import { ControlInputError, createHub, parseCreateInput, type ControlHub } from "./hubs.js";
import { handoffUrl, inviteAdmins, seedSampleInHub } from "./inHub.js";
import { listStates, searchJurisdictions, suggestSlug } from "./jurisdictions.js";
import {
  START_SESSION_TTL_MS,
  StartError,
  clientIp,
  endStartSession,
  normalizeStartEmail,
  openStartSession,
  rateLimit,
  requestStartCode,
  startSessionFromToken,
  verifyStartCode,
  type StartSession,
} from "./startAuth.js";
import { kindsWithSamples } from "../services/sampleTemplates.js";
import { describeInvites } from "../services/adminInvite.js";
import { sendEmail } from "../utils/email.js";
import type { HubMode } from "../models/hub.js";

const COOKIE = "civic_start";
const CSRF_HEADER = "x-civic-start";

/** The start page makes demo hubs only. */
const START_CREATE_MODES: readonly HubMode[] = ["demo"];

declare module "express-serve-static-core" {
  interface Locals {
    startSession?: StartSession;
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
    `Max-Age=${Math.floor(START_SESSION_TTL_MS / 1000)}`,
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
  if (err instanceof StartError || err instanceof EntitlementError || err instanceof ControlInputError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[start]", err);
  res.status(500).json({
    error: "Something went wrong on our side, and your hub may not have been made. Wait a minute and try again; your code still works if it wasn't.",
  });
}

type Handler = (req: Request, res: Response) => Promise<void>;

function route(fn: Handler) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => fail(res, err));
  };
}

function requireStartHost(req: Request, res: Response, next: NextFunction): void {
  if (!isStartHost(req.headers.host)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
    res.status(403).json({ error: "Missing the start page header." });
    return;
  }
  next();
}

const SESSION_ENDED = "Your session on this page has ended. Enter your invite code again.";

/** A live session whose entitlement can still be used, or 401 / 403. */
async function session(req: Request): Promise<StartSession> {
  const s = await startSessionFromToken(readCookie(req, COOKIE));
  if (!s) throw new StartError(SESSION_ENDED, 401);
  if (!(await entitlementStillUsable(s.entitlement_id))) throw new EntitlementError(INVITE_REFUSED, 403);
  return s;
}

async function signedIn(req: Request): Promise<StartSession & { email: string }> {
  const s = await session(req);
  if (!s.email) throw new StartError("Sign in with your email first.", 401);
  return s as StartSession & { email: string };
}

/** The action is done; record it. A failed record is reported, not hidden. */
async function audited(entry: Parameters<typeof recordAudit>[0]): Promise<void> {
  try {
    await recordAudit(entry);
  } catch (err) {
    console.error("[start] AUDIT WRITE FAILED", entry, err);
    throw err;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Tell the operator a code was used (Adam, 2026-10-08). Best effort: the
 * audit row is the record, and a failed email never undoes the hub.
 */
async function notifyOperator(hub: ControlHub, email: string, note: string | null, codeHint: string | null): Promise<void> {
  const operator = consoleAdminEmail();
  if (!operator.ok) return;
  const console_ = consoleHostname();
  const hubLink = `https://${hub.hostname}`;
  const lines = [
    `<p><strong>${escapeHtml(email)}</strong> used an invite code${note ? ` (“${escapeHtml(note)}”)` : ""}${codeHint ? `, ending ${escapeHtml(codeHint)}` : ""}, and created a demo hub:</p>`,
    `<p><strong>${escapeHtml(hub.name)}</strong> — <a href="${escapeHtml(hubLink)}">${escapeHtml(hub.hostname)}</a></p>`,
    console_ ? `<p><a href="https://${escapeHtml(console_)}/#/hubs/${encodeURIComponent(hub.id)}">Open it in the console</a></p>` : "",
  ];
  try {
    const result = await sendEmail({
      to: operator.email,
      subject: `Invite code used: ${hub.name}`,
      html: lines.join("\n"),
    });
    if (!result.sent) console.warn(`[start] operator notice NOT sent (${result.error ?? result.held_back_reason ?? "unknown"}).`);
  } catch (err) {
    console.error("[start] operator notice failed", err);
  }
}

/**
 * The start page's form → the console's create input. What the person may
 * not choose is fixed here: demo mode, the address under the start page's
 * own domain, them as the first admin, samples on where the kind has them,
 * every plugin on.
 */
export function startCreateBody(body: Record<string, unknown>, email: string, hubDomain: string): Record<string, unknown> {
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const slug = str(body.slug, 64).toLowerCase();
  const kind = str(body.hub_kind, 32) || "place";
  const operator = str(body.operator_name);
  const contact = str(body.contact_email, 254) || email;
  return {
    slug,
    name: str(body.name),
    hostname: slug ? `${slug}.${hubDomain}` : "",
    hub_kind: kind,
    jurisdiction_ocd_id: body.jurisdiction_ocd_id,
    jurisdiction_custom: body.jurisdiction_custom === true,
    jurisdiction_name: body.jurisdiction_name,
    jurisdiction_type: body.jurisdiction_type,
    governing_body: body.governing_body,
    governing_body_short: body.governing_body_short,
    timezone: body.timezone,
    admin_email: email,
    mode: "demo",
    sample_content: (kindsWithSamples() as string[]).includes(kind),
    ownership: {
      ...(operator ? { "legal.operator_name": operator } : {}),
      "legal.contact_email": contact,
    },
  };
}

export function startRouter(): Router {
  const r = express.Router();
  r.use(requireStartHost);
  r.use(express.json({ limit: "32kb" }));
  r.use(requireCsrfHeader);

  // Which step the page is on: "code" (no session), "sign_in", or "form".
  r.get("/start/session", route(async (req, res) => {
    const s = await startSessionFromToken(readCookie(req, COOKIE));
    const usable = s ? await entitlementStillUsable(s.entitlement_id) : false;
    res.json({
      step: !s || !usable ? "code" : s.email ? "form" : "sign_in",
      email: usable ? (s?.email ?? null) : null,
      // A session whose code was revoked or used meanwhile: say so once.
      code_refused: Boolean(s && !usable),
    });
  }));

  r.post("/start/invite", route(async (req, res) => {
    await rateLimit("invite", clientIp(req));
    const entitlement = await checkInviteCode((req.body as { code?: unknown })?.code);
    const token = await openStartSession(entitlement.id);
    setSessionCookie(req, res, token);
    res.json({ step: "sign_in" });
  }));

  r.post("/start/request-code", route(async (req, res) => {
    await session(req);
    const email = normalizeStartEmail((req.body as { email?: unknown })?.email);
    await rateLimit("request_code", clientIp(req), email);
    res.json({ message: await requestStartCode(email) });
  }));

  r.post("/start/verify", route(async (req, res) => {
    const s = await session(req);
    const body = (req.body ?? {}) as { email?: unknown; code?: unknown };
    const email = normalizeStartEmail(body.email);
    await rateLimit("verify", clientIp(req));
    await verifyStartCode(s, email, body.code);
    res.json({ step: "form", email });
  }));

  r.post("/start/leave", route(async (req, res) => {
    const s = await startSessionFromToken(readCookie(req, COOKIE));
    if (s) await endStartSession(s);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }));

  // --- What the form needs (signed in) ---

  r.get("/start/config", route(async (req, res) => {
    await signedIn(req);
    res.json({ hub_domain: startHubDomain(), sample_kinds: kindsWithSamples() });
  }));

  r.get("/start/jurisdictions/states", route(async (req, res) => {
    await signedIn(req);
    res.json({ states: await listStates() });
  }));

  r.get("/start/jurisdictions", route(async (req, res) => {
    await signedIn(req);
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const matches = await searchJurisdictions({
      state: str(req.query.state),
      type: str(req.query.type),
      q: str(req.query.q),
      limit: Number(req.query.limit) || undefined,
    });
    // Which hubs already serve a place is the operator's business, not a visitor's.
    res.json({ matches: matches.map((m) => ({ ...m, hubs: [] })) });
  }));

  r.get("/start/slug-suggestion", route(async (req, res) => {
    await signedIn(req);
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    res.json(await suggestSlug({ name: str(req.query.name), type: str(req.query.type) || null, state: str(req.query.state) || null }));
  }));

  // --- Create ---

  r.post("/start/hubs", route(async (req, res) => {
    const s = await signedIn(req);
    await rateLimit("create", clientIp(req));
    const hubDomain = startHubDomain();
    if (!hubDomain) throw new StartError("This page is not set up to create hubs.", 503);
    const input = parseCreateInput(startCreateBody((req.body ?? {}) as Record<string, unknown>, s.email, hubDomain));

    // Hold the code, create, then spend it. A create that fails releases it.
    const claimed = await claimEntitlement(s.entitlement_id, s.email);
    let created: { hub: ControlHub; settings: Record<string, string> };
    try {
      created = await createHub(input, { allowedModes: START_CREATE_MODES, updatedBy: `start:${s.email}` });
    } catch (err) {
      await releaseClaim(claimed.id, s.email);
      throw err;
    }
    const { hub, settings } = created;
    const spent = await redeemEntitlement(claimed, s.email, hub.id);
    await endStartSession(s);
    clearSessionCookie(req, res);

    const entitlement = { entitlement_id: spent.id, code_hint: spent.code_hint, note: spent.note };
    await audited({ actor: s.email, action: "invite.redeem", hubId: hub.id, before: null, after: entitlement });
    await audited({ actor: s.email, action: "hub.create", hubId: hub.id, before: null, after: { hub, settings, via: "start", ...entitlement } });

    let sample: unknown = null;
    if (input.sampleContent) {
      try {
        const report = await seedSampleInHub(hub.id);
        await audited({ actor: s.email, action: "hub.sample_seed", hubId: hub.id, before: null, after: report });
        sample = report;
      } catch (err) {
        console.error(`[start] sample seed failed for ${hub.id}`, err);
        sample = { error: "The sample content could not be added." };
      }
    }
    const invites = await inviteAdmins(hub.id, [s.email]);
    await notifyOperator(hub, s.email, spent.note, spent.code_hint);
    const redirect = await handoffUrl(hub.id, s.email);
    res.status(201).json({
      hub: { id: hub.id, name: hub.name, hostname: hub.hostname },
      redirect,
      sample_content: sample,
      message: describeInvites(invites),
    });
  }));

  r.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return r;
}
