// Express app — exported for use by both the dev server (index.ts)
// and the Vercel serverless function (api/index.ts).
//
// This file sets up all middleware, routes, and auto-seeding.
// It does NOT call app.listen() — that's the caller's job.

import express from "express";
import processRoutes from "./routes/processRoutes.js";
import processLinksRoutes from "./routes/processLinksRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import feedRoutes from "./routes/feedRoutes.js";
import discoveryRoutes from "./routes/discoveryRoutes.js";
import debugRoutes from "./routes/debugRoutes.js";
import inputRoutes from "./routes/inputRoutes.js";
import proposalRoutes from "./routes/proposalRoutes.js";
import proposalDraftRoutes from "./routes/proposalDraftRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import voteDraftRoutes from "./routes/voteDraftRoutes.js";
import voteLogRoutes from "./routes/voteLogRoutes.js";
import voteResultsRoutes from "./routes/voteResultsRoutes.js";
import briefRoutes from "./routes/briefRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import linkPreviewRoutes from "./routes/linkPreviewRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import meetingSummaryRoutes, {
  meetingSummaryCronRouter,
} from "./routes/meetingSummaryRoutes.js";
import { floydNewsSyncCronRouter } from "./routes/floydNewsSyncRoutes.js";
import { adminDigestCronRouter } from "./routes/adminDigestRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import projectDraftRoutes from "./routes/projectDraftRoutes.js";
import deliberationRoutes from "./routes/deliberationRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import waitlistRoutes from "./routes/waitlistRoutes.js";
import {
  digestCronRouter,
  digestUnsubscribeRouter,
  userSettingsRouter,
} from "./routes/digestRoutes.js";
import { handleListAnnouncements } from "./controllers/announcementController.js";
import { assertSpaceIdentityConfigured } from "./config/hub.js";
import { ensureSeeded } from "./debug/autoSeed.js";
import { pingDb } from "./db/client.js";
import { validateEmailConfig } from "./utils/email.js";
import { validateSchemaAtStartup, getSchemaReport } from "./db/schemaCheck.js";

const app = express();

// CORS — allowed origins come from CIVIC_ALLOWED_ORIGINS (comma-separated).
// If the env var is unset and NODE_ENV !== "production", we default to "*"
// for dev convenience. In production, an unset var is a hard failure.
const parsedOrigins = (process.env.CIVIC_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

const isProd = process.env.NODE_ENV === "production";

if (isProd && parsedOrigins.length === 0) {
  throw new Error(
    "CIVIC_ALLOWED_ORIGINS must be set in production (comma-separated list of origins)",
  );
}

const allowedOrigins = new Set(parsedOrigins);
const allowAnyOrigin = !isProd && parsedOrigins.length === 0;

// The space's stable identity must be explicit in production — it is
// `generator.id` on every activity this hub will ever emit. See
// config/hub.ts for why a derived default is unsafe there.
assertSpaceIdentityConfigured();

validateEmailConfig();
// Schema contract check — logs once per cold start. Non-blocking: a hub with
// drift must still boot, precisely so /health can explain what is wrong.
validateSchemaAtStartup();

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (allowAnyOrigin) {
    res.header("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

// Ensure seed data exists on every request (handles Vercel multi-instance cold starts)
app.use(ensureSeeded as express.RequestHandler);

// Auth endpoints — email-based authentication
app.use("/auth", authRoutes);

// --- Internal control surfaces ---
// Process endpoints are internal. External systems should use /events.
// Process-linking is universal: mounted once on /process, it serves every
// process type — including types registered later — with no per-type wiring.
// MOUNTED FIRST, deliberately: processRoutes has a GET /:id catch-all that
// would otherwise capture /process/link-candidates as a process id.
app.use("/process", processLinksRoutes);
app.use("/process", processRoutes);
app.use("/process", inputRoutes);

// Proposal draft endpoints — AI-augmented drafting (mounted before /proposals
// so /proposals/drafts doesn't get caught by /proposals/:id).
app.use("/proposals/drafts", proposalDraftRoutes);

// Vote draft endpoints — AI-augmented vote drafting (mounted before /votes
// so /votes/drafts doesn't get caught by /votes/:id).
app.use("/votes/drafts", voteDraftRoutes);

// Project draft endpoints — AI-augmented project drafting (mounted before
// /projects so /projects/drafts doesn't get caught by /projects/:id).
app.use("/projects/drafts", projectDraftRoutes);

// Project endpoints — community project pages with sentiment + comments
app.use("/projects", projectRoutes);

// Deliberation endpoints — Polis-backed community deliberation
app.use("/deliberations", deliberationRoutes);

// Word cloud endpoints — lightweight free-text aggregation process
import wordcloudRoutes from "./routes/wordcloudRoutes.js";
app.use("/wordcloud", wordcloudRoutes);

// Proposal endpoints — user-facing proposal submission and endorsement
app.use("/proposals", proposalRoutes);

// Process review — resident submissions go through collaborative admin review
app.use("/reviews", reviewRoutes);

// Notification indicator (review attention badge) — requireAuth, both roles
app.use("/notifications", notificationRoutes);

// Admin endpoints — proposal review and conversion to votes
app.use("/admin", adminRoutes);

// Vote log and receipt verification
app.use("/votes", voteLogRoutes);

// Vote results — public read of published vote-results pages.
// Renamed from /brief in Slice 8.5.
app.use("/vote-results", voteResultsRoutes);

// Briefs — public read of published civic.brief pages (the universal
// results record for any completed process). Reclaims the /brief path from
// the Slice 8.5 legacy redirect: /brief now serves the NEW generic brief;
// existing published vote-results stay at /vote-results/:id.
app.use("/brief", briefRoutes);

// Board / Admin announcements — post, edit, read one
app.use("/announcement", announcementRoutes);
// Public list — separate path so it doesn't collide with /announcement/:id
app.get("/announcements", handleListAnnouncements);

// Slice 9 — image upload + link previews. The upload endpoint is
// authenticated (requireAnnouncementPoster) and accepts multipart bodies;
// the link-preview endpoint is public and lightly rate-limited.
app.use("/upload", uploadRoutes);
app.use("/link-preview", linkPreviewRoutes);

// Slice 10.5 — public full-text search across all process types.
// Backed by Postgres FTS via the search_processes RPC (see
// supabase/migrations/20260427200000_add_search_doc.sql).
app.use("/search", searchRoutes);

// Slice 14 — operator-facing product feedback. Anonymous or authed.
// Persists to feedback_submissions (NOT events) and best-effort emails
// the operator. See civic-hub/src/modules/civic.feedback.
app.use("/feedback", feedbackRoutes);

// Beta waitlist — public endpoint for people to request access.
app.use("/waitlist", waitlistRoutes);

// Meeting summaries (Slice 6):
//   /meeting-summary/:id    — public read of published summaries
app.use("/meeting-summary", meetingSummaryRoutes);

// Digest (Slice 5) + Meeting summary (Slice 6) + Floyd-news-sync
// (Slice 13) + Admin-digest (Slice 16) crons all mount here. Vercel
// Cron POSTs with the CRON_SECRET bearer, auto-injected.
//   /internal/digest/run
//   /internal/meeting-summary/run
//   /internal/floyd-news-sync/run
//   /internal/admin-digest/run
app.use("/internal", digestCronRouter);
app.use("/internal", meetingSummaryCronRouter);
app.use("/internal", floydNewsSyncCronRouter);
app.use("/internal", adminDigestCronRouter);
app.use("/unsubscribe", digestUnsubscribeRouter);
app.use("/user/settings", userSettingsRouter);

// --- Primary public interfaces ---
// Events are the PRIMARY public interface of the hub. /events serves the AS2
// activity collection defined by Civic Activity Spec v0.2 §6; /activities/:id
// dereferences a single activity by the id its own document carries.
// All external systems (feeds, dashboards, federation) read these.
app.use("/events", eventRoutes);
app.use("/activities", activityRoutes);

// Internal read model for the hub's own UI — the pre-v0.2 `{ events, count }`
// shape, unchanged. Mounted twice on purpose: on Vercel the `/api` prefix is
// stripped before Express sees the request (api/index.ts), so "/feed" IS
// "/api/feed" in production, while the explicit mount keeps the same URL
// working against a local dev server on :3000.
app.use("/feed", feedRoutes);
app.use("/api/feed", feedRoutes);

// Discovery manifest
app.use("/.well-known", discoveryRoutes);

// Debug / seed (development only)
app.use("/debug", debugRoutes);

// Root — overview of available endpoints
app.get("/", (_req, res) => {
  res.json({
    name: "Civic Hub",
    version: "0.1.0",
    description: "Reference implementation of a Civic Hub backend",
    endpoints: {
      "GET /process": "List all processes (UI read layer)",
      "GET /process/:id/state": "Get UI-friendly process state with tally",
      "POST /process": "Create a new process (internal)",
      "GET /process/:id": "Get a process by ID (internal)",
      "POST /process/:id/action": "Execute an action on a process (internal)",
      "POST /process/:id/input": "Submit community input for a process",
      "GET /process/:id/input": "Get all community inputs for a process",
      "POST /proposals": "Submit a new civic proposal",
      "GET /proposals": "List proposals (optional ?status= filter)",
      "GET /proposals/:id": "Get proposal detail (optional ?actor= for support check)",
      "POST /proposals/:id/support": "Endorse a proposal",
      "GET /admin/proposals": "List proposals for admin moderation",
      "GET /admin/proposals/:id": "Get full proposal detail for admin",
      "POST /admin/proposals/:id/archive": "Archive a proposal",
      "POST /auth/request-code": "Request email verification code",
      "POST /auth/verify": "Verify code and get session token",
      "POST /auth/residency": "Affirm Floyd County residency (requires auth)",
      "GET /auth/me": "Get current authenticated user",
      "POST /auth/logout": "Destroy session",
      "GET /votes/:id/log": "Public vote audit log (available after vote closes)",
      "GET /votes/:id/verify?receipt=X": "Verify a vote receipt",
      "GET /admin/vote-results": "List vote results for admin review (optional ?status=)",
      "GET /admin/vote-results/:id": "Get full vote-results detail for admin",
      "PATCH /admin/vote-results/:id": "Edit comments/notes (pending only)",
      "POST /admin/vote-results/:id/approve": "Approve: email Board + publish to feed",
      "GET /vote-results/:id": "Public read of a published vote-results page",
      "GET /brief/:id": "Legacy → 301 redirect to /vote-results/:id",
      "POST /announcement": "Post a Board announcement (Board or admin)",
      "PATCH /announcement/:id": "Edit an announcement (author only, or any admin)",
      "GET /announcement/:id": "Public read of an announcement",
      "GET /announcements": "List announcements, newest first (optional ?limit=N)",
      "POST /upload/post-image": "Upload a featured image (multipart, authed)",
      "GET /link-preview?url=X": "Fetch (cached) OpenGraph preview for a URL",
      "GET /search?q=X": "Full-text search across all process types (public)",
      "POST /feedback": "Submit product feedback (anonymous or authed; honeypot-gated)",
      "POST /waitlist": "Join the beta waitlist (public; honeypot-gated)",
      "POST /internal/digest/run": "Cron-triggered daily email digest (CRON_SECRET bearer)",
      "GET /unsubscribe/digest?token=X": "Unsubscribe from the daily digest",
      "PATCH /user/settings/digest": "Toggle digest subscription (authed)",
      "POST /internal/meeting-summary/run": "Cron-triggered meeting discovery + summarization (CRON_SECRET bearer)",
      "POST /internal/floyd-news-sync/run": "Cron-triggered Floyd news/announcement sync (CRON_SECRET bearer)",
      "POST /internal/admin-digest/run": "Cron-triggered admin queue digest (CRON_SECRET bearer)",
      "GET /admin/meeting-summaries": "List meeting summaries for admin review (optional ?status=)",
      "GET /admin/meeting-summaries/:id": "Get full meeting summary detail for admin",
      "PATCH /admin/meeting-summaries/:id": "Edit meeting summary blocks/notes (pending only)",
      "POST /admin/meeting-summaries/:id/approve": "Approve and publish a meeting summary",
      "GET /meeting-summary/:id": "Public read of a published meeting summary",
      "GET /events": "AS2 OrderedCollection of civic activities (primary public interface)",
      "GET /events?page=true": "First OrderedCollectionPage (follow `next` for older pages)",
      "GET /events?context=X": "Filter by process (process IRI or bare process id)",
      "GET /events?type=X": "Filter by activity type (e.g., Create, Announce, civic:End)",
      "GET /events?since=X&limit=N": "Filter by RFC 3339 timestamp; page size (default 50, max 200)",
      "GET /activities/:id": "Dereference a single civic activity",
      "GET /api/feed": "Internal UI read model: { events, count } (process_id / event_type / pretty filters)",
      "GET /.well-known/civic.json": "Discovery manifest",
      "GET /debug/seed": "Seed sample data (dev only)",
      "GET /health": "Health check",
    },
  });
});

// Health check — includes a DB ping so you can verify Supabase connectivity
app.get("/health", async (_req, res) => {
  const db = await pingDb();
  // Connectivity is not correctness: the ping passed throughout the
  // 2026-08-22 waitlist outage while every write to that table failed. The
  // schema report is what makes "deployed code vs applied migrations" visible.
  const schema = await getSchemaReport().catch((err) => ({
    ok: true as const,
    checked: 0,
    gaps: [],
    inconclusive: [{ table: "*", detail: err instanceof Error ? err.message : String(err) }],
    duration_ms: 0,
  }));
  // Vercel injects the deployed commit SHA at build time. Exposing it here
  // makes "is the latest code actually live?" answerable in one request:
  // compare this to `git rev-parse HEAD` locally.
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown";
  const healthy = db.ok && schema.ok;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    db,
    schema: {
      ok: schema.ok,
      checked: schema.checked,
      // Only the gaps travel in the response — enough to name the missing
      // column, not enough to enumerate the schema to an anonymous caller.
      gaps: schema.gaps.map((g) => `${g.table}: ${g.detail}`),
    },
    commit,
    deployed_at: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    timestamp: new Date().toISOString(),
  });
});

// Auto-seed is triggered by the `ensureSeeded` middleware on first request,
// and is gated behind CIVIC_ALLOW_SEED so it never runs in production.

// Terminal error handler — MUST be the last app.use, after all routes. Catches
// synchronous throws in middleware and anything a handler passes to next(err),
// logs it (the observability gap: no Sentry yet), and always returns a clean
// 500 without leaking internals. Controllers already try/catch their own async
// errors; this is the safety net for the rest so an error can't hang a request.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[unhandled] ${message}`,
      err instanceof Error ? err.stack : "",
    );
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
