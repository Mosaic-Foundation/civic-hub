// Phase 3 leak harness: two hubs, every endpoint, nothing of hub B comes back
// to a caller on hub A.
//
// Hub B is Floyd, hub A is Athens (both in every local stack). Floyd gets one
// of everything a hub holds — a vote with a ballot and a comment, a word
// cloud, a proposal with a supporter, a project with a sentiment, a review, a
// draft of every kind, a published outcome, a conversation, a meeting
// summary, an announcement with an image, a process link, feedback, a
// waitlist entry, a cached link preview, a resident, and settings — each
// carrying MARKER_B, and every id recorded. Then, as Athens:
//
//   1. GET, every route the app mounts. The list comes from the Express app
//      itself, so a route added later fails "every GET route has a plan"
//      until it is walked here or skipped with a reason. Each route is called
//      signed out, as an Athens resident and as an Athens admin; every `:id`
//      is tried with each of Floyd's ids (and an Athens id, the control).
//      Lists, detail pages, search, feeds, /events, word clouds, link
//      previews and the settings routes are all in that walk.
//   2. Every mutating route that names an id, with each of Floyd's ids, as
//      an Athens admin and resident; and the routes that take ids in the body.
//   3. The digest, in-process: Athens's run is captured and read.
//
// After each response: MARKER_B must not appear, no Floyd id may appear except
// the one the caller put in the path (an error may echo it), and every
// post-images URL must be under athens/. Floyd's rows are snapshotted before
// the walk and must be identical after it.
//
// RUN IT TWICE: once against a server with CIVIC_HUB_MINTED_TOKEN off and once
// with it on (CI does both; TESTING.md). The mode is read from /health and
// printed; CIVIC_EXPECT_HUB_DB_MODE makes a run fail if the server is not in
// the mode it was started for. Needs the local stack seeded as in CI and a
// server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

// ---- the digest's mail, captured in-process (section 3) --------------------
const mailbox = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string; text: string }>);
vi.mock("../../src/utils/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/email.js")>()),
  sendEmail: async (m: { to: string; subject: string; html: string; text: string }) => {
    mailbox.push(m);
    return { sent: true, id: "captured" };
  },
}));

const FLOYD = "floyd.civic.social";
const ATHENS = "athens.localhost";
const FLOYD_ADMIN = "admin@example.test";
const ATHENS_ADMIN = "admin+athens@example.test";

const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
/** On every Floyd row this test writes. Lowercase alnum: survives search tokenizing and email lowercasing. */
const MARKER_B = `zqleakb${run}`;
/** On Athens's rows: the positive control, proving a walk saw real data. */
const MARKER_A = `zqleaka${run}`;

// Local stack keys for the in-process part. Public, fixed CLI values; the
// fixture refuses any non-local SUPABASE_URL.
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
/** Must equal the server's DIGEST_UNSUBSCRIBE_SECRET (CI sets both). */
const DIGEST_SECRET = process.env.CIVIC_TEST_DIGEST_SECRET?.trim() || "ci-only-digest-unsubscribe-secret";

type Res = { status: number; body: any };
type Rows = Array<Record<string, unknown>>;

let mode: "hub_token" | "service_role" = "service_role";
const tokens = { floydAdmin: "", floydResident: "", athensAdmin: "", athensResident: "" };

/** Every Floyd id this test knows, by kind. */
const B: Record<string, string> = {};
/** Athens ids, the controls. */
const A: Record<string, string> = {};
/** Floyd rows written straight into the stack, deleted afterwards. */
const directProcessIds: string[] = [];
/** Floyd's settings as they were, captured before this test changes them; null until then. */
let floydSettingsBefore: Rows | null = null;

function ok(res: Res, expected = 200) {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(expected);
}

function imageUrl(hub: string) {
  return `http://127.0.0.1:54321/storage/v1/object/public/post-images/${hub}/2026/09/${hub === "floyd" ? MARKER_B : MARKER_A}.png`;
}

async function createProcess(host: string, token: string, type: string, title: string, state: Record<string, unknown>) {
  const res = await call("POST", "/process", host, { definition: { type, version: "0.1" }, title, description: title, state }, token);
  ok(res, 201);
  const id = (res.body.id ?? res.body.process?.id) as string;
  ok(await call("POST", `/process/${id}/action`, host, { type: "process.activate", payload: {} }, token));
  return id;
}

async function insertProcess(id: string, hub: string, type: string, title: string, status: string, state: Record<string, unknown>) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({ id, hub_id: hub, type, title, description: title, status, state }),
  });
  directProcessIds.push(id);
}

// ---------------------------------------------------------------------------
// The leak check

const IMAGE_PREFIX = /post-images\/([^/"'\\\s]+)\//g;

/**
 * `echoed` are ids the caller put in the path: an error may repeat one inside
 * a message, which tells the caller nothing, so they are discounted wherever
 * they appear. `echoedValues` are query values (a search term, a URL): they
 * are discounted only as a whole JSON string value — the response's own copy
 * of the query — so a hit whose title merely CONTAINS the term still fails.
 */
function leakCheck(label: string, res: Res, echoed: string[] = [], echoedValues: string[] = []): string[] {
  let text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
  for (const v of echoedValues) text = text.split(JSON.stringify(v)).join('"<requested>"');
  for (const e of echoed) text = text.split(e).join("<requested>");
  const problems: string[] = [];
  if (text.toLowerCase().includes(MARKER_B)) problems.push(`${label}: Floyd's marker in the response`);
  for (const [kind, id] of Object.entries(B)) {
    if (id && text.includes(id)) problems.push(`${label}: Floyd's ${kind} id ${id} in the response`);
  }
  for (const m of text.matchAll(IMAGE_PREFIX)) {
    if (m[1] !== "athens") problems.push(`${label}: an image under ${m[1]}/`);
  }
  return problems;
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Floyd's rows: counted per table, and the rows this test knows compared whole

const HUB_TABLES_FOR_SNAPSHOT = [
  "active_vote_keys", "brief_responses", "community_inputs", "deliberation_drafts",
  "deliberation_submissions", "deliberation_votes", "events", "feedback_submissions",
  "hub_settings", "link_previews", "pending_verifications", "process_links",
  "process_reviews", "processes", "project_comments", "project_drafts",
  "project_sentiments", "project_updates", "projects", "proposal_drafts",
  "proposal_supports", "proposals", "review_turns", "sessions", "users",
  "vote_drafts", "vote_participation", "vote_records", "waitlist",
  "wordcloud_submissions",
];

async function floydCount(table: string): Promise<number> {
  const { url, key } = localStack();
  const res = await fetch(`${url}/rest/v1/${table}?select=hub_id&hub_id=eq.floyd`, {
    method: "HEAD",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  return Number((res.headers.get("content-range") ?? "*/0").split("/")[1]);
}

async function snapshotFloyd(): Promise<Record<string, unknown>> {
  const snap: Record<string, unknown> = {};
  for (const t of HUB_TABLES_FOR_SNAPSHOT) snap[`count:${t}`] = await floydCount(t);
  const inList = (ids: string[]) => `(${ids.map((i) => `"${i}"`).join(",")})`;
  const processIds = [B.vote, B.wordcloud, B.proposal, B.project, B.brief, B.conversation, B.announcement, B.meeting].filter(Boolean);
  const q = async (path: string) => (await localRest(path)) as Rows;
  snap.processes = await q(`processes?id=in.${inList(processIds)}&order=id`);
  snap.inputs = await q(`community_inputs?process_id=in.${inList(processIds)}&order=id`);
  snap.ballots = await q(`vote_records?process_id=eq.${B.vote}&order=receipt_id`);
  snap.participation = await q(`vote_participation?process_id=eq.${B.vote}&order=user_id`);
  snap.bridge = await q(`active_vote_keys?process_id=eq.${B.vote}&order=user_id`);
  snap.links = await q(`process_links?hub_id=eq.floyd&order=id`);
  snap.reviews = await q(`process_reviews?id=eq.${B.review}`);
  snap.settings = await q(`hub_settings?hub_id=eq.floyd&order=key`);
  snap.users = await q(`users?hub_id=eq.floyd&email=like.*${MARKER_B}*&order=id`);
  snap.drafts = [
    await q(`vote_drafts?id=eq.${B.voteDraft}`),
    await q(`proposal_drafts?id=eq.${B.proposalDraft}`),
    await q(`project_drafts?id=eq.${B.projectDraft}`),
    await q(`deliberation_drafts?id=eq.${B.deliberationDraft}`),
  ];
  snap.proposals = await q(`proposals?hub_id=eq.floyd&order=id`);
  snap.supports = await q(`proposal_supports?hub_id=eq.floyd&order=proposal_id,user_id`);
  snap.projects = await q(`projects?hub_id=eq.floyd&order=id`);
  snap.sentiments = await q(`project_sentiments?hub_id=eq.floyd&order=project_id,user_id`);
  snap.previews = await q(`link_previews?hub_id=eq.floyd&order=url`);
  snap.waitlist = await q(`waitlist?hub_id=eq.floyd&order=email`);
  snap.feedback = await q(`feedback_submissions?hub_id=eq.floyd&message=like.*${MARKER_B}*&order=id`);
  return snap;
}

// ---------------------------------------------------------------------------
// Setup: one of everything on Floyd, a little on Athens

beforeAll(async () => {
  const health = await call("GET", "/health", FLOYD);
  mode = health.body?.hub_db?.mode ?? "service_role";
  console.log(`[leak-harness] server hub_db mode: ${mode}`);
  const expected = process.env.CIVIC_EXPECT_HUB_DB_MODE?.trim();
  if (expected) expect(mode, "the server is not in the mode this run was started for").toBe(expected);
  expect(health.body?.hub_db?.ok, JSON.stringify(health.body)).toBe(true);

  tokens.floydAdmin = await mintSession("floyd", FLOYD_ADMIN);
  tokens.floydResident = await mintSession("floyd", `${MARKER_B}@example.test`);
  tokens.athensAdmin = await mintSession("athens", ATHENS_ADMIN);
  tokens.athensResident = await mintSession("athens", `${MARKER_A}@example.test`);

  const [fr] = (await localRest(`users?select=id&hub_id=eq.floyd&email=eq.${MARKER_B}@example.test`)) as Array<{ id: string }>;
  B.resident = fr.id;
  // Subscribed, so an unsubscribe link that crossed hubs would change the row.
  await localRest(`users?id=eq.${B.resident}`, {
    method: "PATCH",
    body: JSON.stringify({ full_name: `Resident ${MARKER_B}`, digest_frequency_days: 1 }),
  });
  const { buildUnsubscribeToken } = await import("../../src/modules/civic.digest/unsubscribe.js");
  B.unsubscribeToken = buildUnsubscribeToken(B.resident, DIGEST_SECRET);
  const [ar] = (await localRest(`users?select=id&hub_id=eq.athens&email=eq.${MARKER_A}@example.test`)) as Array<{ id: string }>;
  A.resident = ar.id;
  // Athens's resident takes the digest, and has been around long enough for
  // this run's events to fall in its window.
  await localRest(`users?id=eq.${A.resident}`, {
    method: "PATCH",
    body: JSON.stringify({ digest_frequency_days: 1, last_digest_sent_at: null, created_at: new Date(Date.now() - 86_400_000).toISOString() }),
  });

  // --- Floyd (hub B) ---
  const voteState = { options: [`Yes ${MARKER_B}`, "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" };
  B.vote = await createProcess(FLOYD, tokens.floydAdmin, "civic.vote", `Vote ${MARKER_B}`, voteState);
  const ballot = await call("POST", `/process/${B.vote}/action`, FLOYD, { type: "process.vote", payload: { option: `Yes ${MARKER_B}` } }, tokens.floydResident);
  ok(ballot);
  B.receipt = JSON.stringify(ballot.body).match(/"receipt_id"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  const comment = await call("POST", `/process/${B.vote}/input`, FLOYD, { body: `Comment ${MARKER_B}` }, tokens.floydResident);
  ok(comment, 201);
  B.comment = comment.body.id ?? comment.body.input?.id;

  B.wordcloud = await createProcess(FLOYD, tokens.floydAdmin, "civic.wordcloud", `Cloud ${MARKER_B}`, {
    prompts: [{ id: "p1", text: `Prompt ${MARKER_B}` }],
  });
  ok(await call("POST", `/process/${B.wordcloud}/action`, FLOYD, { type: "process.submit", payload: { prompt_id: "p1", text: `w${MARKER_B}` } }, tokens.floydResident));

  const proposal = await call("POST", "/proposals", FLOYD, { title: `Proposal ${MARKER_B}`, description: `About ${MARKER_B}` }, tokens.floydResident);
  ok(proposal, 201);
  B.proposal = proposal.body.id;
  const support = await call("POST", `/proposals/${B.proposal}/support`, FLOYD, {}, tokens.floydAdmin);
  expect(support.status).toBeLessThan(500);

  const project = await call("POST", "/projects", FLOYD, { title: `Project ${MARKER_B}`, description: `About ${MARKER_B}` }, tokens.floydResident);
  ok(project, 201);
  B.project = project.body.id;
  ok(await call("POST", `/projects/${B.project}/sentiment`, FLOYD, { sentiment: "support" }, tokens.floydAdmin));

  const review = await call(
    "POST",
    "/reviews/submit",
    FLOYD,
    { process_type: "civic.vote", title: `Review ${MARKER_B}`, description: `About ${MARKER_B}`, state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000 } },
    tokens.floydResident,
  );
  ok(review, 201);
  B.review = review.body.review?.id ?? review.body.review_id ?? review.body.id;

  for (const [kind, key] of [["votes", "voteDraft"], ["proposals", "proposalDraft"], ["projects", "projectDraft"], ["deliberations", "deliberationDraft"]] as const) {
    const d = await call("POST", `/${kind}/drafts`, FLOYD, {}, tokens.floydResident);
    ok(d, 201);
    B[key] = d.body.id ?? d.body.draft?.id;
  }

  const link = await call("POST", `/process/${B.vote}/links`, FLOYD, { to_id: B.wordcloud, relation: "references" }, tokens.floydAdmin);
  expect(link.status, JSON.stringify(link.body)).toBeLessThan(300);
  B.link = link.body.link_id ?? link.body.id ?? "";

  const announcement = await call("POST", "/announcement", FLOYD, { title: `Notice ${MARKER_B}`, body: `Body ${MARKER_B}`, image_url: imageUrl("floyd") }, tokens.floydAdmin);
  if (announcement.status < 300) {
    B.announcement = announcement.body.id ?? announcement.body.process?.id;
  } else {
    B.announcement = `proc_ann_${MARKER_B}`;
    await insertProcess(B.announcement, "floyd", "civic.announcement", `Notice ${MARKER_B}`, "finalized", {
      content: { title: `Notice ${MARKER_B}`, body: `Body ${MARKER_B}`, image_url: imageUrl("floyd") },
    });
  }

  B.brief = `proc_brief_${MARKER_B}`;
  await insertProcess(B.brief, "floyd", "civic.brief", `Outcome ${MARKER_B}`, "finalized", {
    publication_status: "published",
    published_at: new Date().toISOString(),
    source_process_id: B.vote,
    source_process_type: "civic.vote",
    content: { headline: `Headline ${MARKER_B}`, participation_label: "3 residents", image_url: imageUrl("floyd") },
  });
  B.conversation = `proc_conv_${MARKER_B}`;
  await insertProcess(B.conversation, "floyd", "civic.polis_deliberation", `Conversation ${MARKER_B}`, "active", {
    polis_conversation_id: "", polis_base_url: "", topic: `Topic ${MARKER_B}`, framing: `Framing ${MARKER_B}`, deadline: null, duration_ms: null,
    participation_threshold: null, assistant_helped: false, seed_statements: null, sources: null, last_math_tick: 0,
    summary: null, summary_status: "pending", continued_from_response_id: null,
  });
  B.meeting = `proc_meet_${MARKER_B}`;
  await insertProcess(B.meeting, "floyd", "civic.meeting_summary", `Meeting ${MARKER_B}`, "draft", {
    meeting_title: `Meeting ${MARKER_B}`, summary: `Summary ${MARKER_B}`, publication_status: "pending",
  });

  ok(await call("POST", "/feedback", FLOYD, { category: "general", message: `Feedback ${MARKER_B}` }, tokens.floydResident));
  const wl = await call("POST", "/waitlist", FLOYD, { email: `wait-${MARKER_B}@example.test`, name: `Waiting ${MARKER_B}` });
  expect(wl.status).toBeLessThan(500);

  B.previewUrl = `https://example.test/${MARKER_B}`;
  await localRest("link_previews", {
    method: "POST",
    body: JSON.stringify({ hub_id: "floyd", url: B.previewUrl, title: `Preview ${MARKER_B}`, description: `Preview ${MARKER_B}`, image_url: imageUrl("floyd"), fetched_at: new Date().toISOString() }),
  });

  floydSettingsBefore = (await localRest("hub_settings?hub_id=eq.floyd&key=in.(identity.tagline,identity.banner_url,copy.about)")) as Rows;
  await localRest("hub_settings?on_conflict=hub_id,key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([
      { hub_id: "floyd", key: "identity.tagline", value: `Tagline ${MARKER_B}` },
      { hub_id: "floyd", key: "identity.banner_url", value: imageUrl("floyd") },
      { hub_id: "floyd", key: "copy.about", value: `About ${MARKER_B}` },
    ]),
  });

  const events = (await localRest(`events?select=id&hub_id=eq.floyd&process_id=eq.${B.vote}&order=created_at.desc&limit=3`)) as Array<{ id: string }>;
  events.forEach((e, i) => (B[`event${i}`] = e.id));

  // --- Athens (hub A): the controls ---
  A.vote = await createProcess(ATHENS, tokens.athensAdmin, "civic.vote", `Vote ${MARKER_A}`, {
    options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct",
  });
  ok(await call("POST", `/process/${A.vote}/input`, ATHENS, { body: `Comment ${MARKER_A}` }, tokens.athensResident), 201);

  for (const [k, v] of Object.entries(B)) expect(v, `Floyd fixture ${k}`).toBeTruthy();
}, 60_000);

afterAll(async () => {
  for (const id of directProcessIds) await localRest(`processes?id=eq.${id}`, { method: "DELETE" }).catch(() => undefined);
  await localRest(`link_previews?hub_id=eq.floyd&url=eq.${encodeURIComponent(B.previewUrl ?? "")}`, { method: "DELETE" }).catch(() => undefined);
  // Put back exactly what was there — only if it was captured, so a run that
  // failed before touching the settings leaves them alone.
  if (floydSettingsBefore) {
    await localRest("hub_settings?hub_id=eq.floyd&key=in.(identity.tagline,identity.banner_url,copy.about)", { method: "DELETE" });
    if (floydSettingsBefore.length) {
      await localRest("hub_settings", { method: "POST", body: JSON.stringify(floydSettingsBefore) });
    }
  }
});

// ---------------------------------------------------------------------------
// 1. Every GET route

/**
 * How each GET route is walked. A route the app mounts that is missing here
 * fails the coverage test: add it, with query variants if it reads the query,
 * or skip it with the reason.
 */
type Plan = { query?: string[]; skip?: string; ids?: "events" };
const GET_PLAN: Record<string, Plan> = {
  "GET /": {},
  "GET /health": {},
  "GET /hub-config": {},
  "GET /hub-config/documents": { query: ["", "?key=copy.about", "?keys=copy.about"] },
  "GET /auth/me": {},
  "GET /process/": {},
  "GET /process/link-candidates": { query: ["", `?q=${MARKER_B}`, "?q=Vote"] },
  "GET /process/:id/links": {},
  "GET /process/:id/edits": {},
  "GET /process/:id/edit-policy": {},
  "GET /process/:id/state": {},
  "GET /process/:id": {},
  "GET /process/input/identity-mode": {},
  "GET /process/:id/input": {},
  "GET /share/meta": { query: [] /* filled in below: ?page=/<section>/<floyd id> */ },
  "GET /assistant/:processType/config": {},
  "GET /proposals/drafts/": {},
  "GET /proposals/drafts/:id": {},
  "GET /votes/drafts/": {},
  "GET /votes/drafts/duration-limits": {},
  "GET /votes/drafts/:id": {},
  "GET /projects/drafts/:id": {},
  "GET /projects/": {},
  "GET /projects/:id": {},
  "GET /deliberations/drafts/:id": {},
  "GET /deliberations/": {},
  "GET /deliberations/:processId": {},
  "GET /deliberations/:processId/clusters": {},
  "GET /deliberations/:processId/participate/next": {},
  "GET /wordcloud/:id/cloud": {},
  "GET /wordcloud/:id/responses": {},
  "GET /wordcloud/:id": {},
  "GET /proposals/": {},
  "GET /proposals/:id": {},
  "GET /reviews/mine": {},
  "GET /reviews/:reviewId": {},
  "GET /notifications/reviews/count": {},
  "GET /notifications/edits": {},
  "GET /admin/proposals": {},
  "GET /admin/proposals/:id": {},
  "GET /admin/vote-results": {},
  "GET /admin/vote-results/:id": {},
  "GET /admin/briefs": {},
  "GET /admin/briefs/:id": {},
  "GET /admin/meeting-summaries": {},
  "GET /admin/meeting-summaries/:id": {},
  "GET /admin/reviews": {},
  "GET /admin/reviews/:reviewId": {},
  "GET /admin/archived": {},
  "GET /admin/edits": {},
  "GET /admin/feedback": {},
  "GET /admin/queue-counts": {},
  "GET /admin/hub/people": {},
  "GET /admin/hub/settings": {},
  "GET /admin/hub/settings/template/:key": {},
  "GET /admin/settings": {},
  "GET /admin/moderation/log": {},
  "GET /votes/:id/log": {},
  "GET /votes/:id/verify": { query: [] /* filled in below: ?receipt=<floyd receipt> */ },
  "GET /vote-results/:id": {},
  "GET /brief/": {},
  "GET /brief/:id": {},
  "GET /announcement/:id": {},
  "GET /announcements": {},
  "GET /link-preview/": { query: [] /* filled in below: ?url=<floyd's cached url> */ },
  "GET /search/": { query: [`?q=${MARKER_B}`, "?q=Vote", "?q=Notice&sort=newest", `?q=${MARKER_A}`] },
  "GET /meeting-summary/:id": {},
  "GET /unsubscribe/digest": { query: [] /* filled in below: none, a bad token, Floyd's resident's token */ },
  "GET /events/": { query: ["", "?limit=500", "?page=true&limit=200", `?context=${"x"}`] },
  "GET /activities/:id": { ids: "events" },
  "GET /ns/": {},
  "GET /feed/": { query: ["", "?limit=200", "?process_id=" /* + floyd vote, below */] },
  "GET /api/feed/": { query: ["", "?limit=200"] },
  "GET /\\.well-known/civic.json": {},
  "GET /debug/seed": { skip: "writes seed data (dev only, CIVIC_ALLOW_SEED); not a read surface" },
  "GET /internal/meeting-summary/run": { skip: "cron: calls the model and the hub's meeting source; per-hub scope is tests/unit/jobsPerHub" },
  "GET /internal/news-sync/run": { skip: "cron: fetches the hub's external feed; per-hub scope is tests/unit/jobsPerHub" },
  "GET /internal/floyd-news-sync/run": { skip: "cron (deprecated path of news-sync); as above" },
  "GET /internal/digest/run": { skip: "cron: returns counts only; the digest's content is walked in-process below" },
  "GET /internal/admin-digest/run": { skip: "cron: returns counts only; admin digest per hub is tests/api/crons" },
};

async function appRoutes(): Promise<string[]> {
  const { url, key } = localStack();
  process.env.SUPABASE_URL ??= url;
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= key;
  const app = (await import("../../src/app.js")).default as any;
  const out: string[] = [];
  const prefixOf = (re: RegExp & { fast_slash?: boolean }) =>
    re.fast_slash ? "" : re.source.replace("^\\", "").replace("\\/?(?=\\/|$)", "").replace(/\\\//g, "/");
  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + prefixOf(layer.regexp));
      }
    }
  };
  walk(app._router.stack, "");
  return [...new Set(out)];
}

function idsFor(plan: Plan): { floyd: string[]; athens: string[] } {
  if (plan.ids === "events") return { floyd: [B.event0, B.event1, B.event2].filter(Boolean), athens: [] };
  const floyd = Object.entries(B)
    .filter(([k]) => !["previewUrl", "receipt", "resident", "unsubscribeToken"].includes(k) && !k.startsWith("event"))
    .map(([, v]) => v);
  return { floyd, athens: [A.vote] };
}

function expand(route: string, plan: Plan): Array<{ path: string; echoed: string[]; values: string[] }> {
  const path = route.slice(route.indexOf(" ") + 1).replace("\\.", ".");
  const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
  let queries = plan.query ?? [""];
  if (route === "GET /share/meta") {
    queries = ["", ...["process", "proposals", "projects", "wordcloud", "brief", "announcement", "deliberations"].flatMap((s) =>
      [B.vote, B.proposal, B.project, B.wordcloud, B.brief, B.announcement, B.conversation].map((id) => `?page=/${s}/${id}`),
    )];
  }
  if (route === "GET /votes/:id/verify") queries = ["", `?receipt=${B.receipt}`];
  if (route === "GET /link-preview/") queries = ["", `?url=${encodeURIComponent(B.previewUrl)}`];
  if (route === "GET /unsubscribe/digest") queries = ["", "?token=not-a-real-token", `?token=${encodeURIComponent(B.unsubscribeToken)}`];
  if (route === "GET /feed/") queries = ["", "?limit=200", `?process_id=${B.vote}`];

  const out: Array<{ path: string; echoed: string[]; values: string[] }> = [];
  for (const q of queries) {
    const values = [...new URLSearchParams(q.replace(/^\?/, "")).values()].filter(Boolean);
    const echoed: string[] = [];
    if (q.includes(B.receipt)) echoed.push(B.receipt);
    for (const id of [B.vote, B.proposal, B.project, B.wordcloud, B.brief, B.announcement, B.conversation]) {
      if (q.includes(id)) echoed.push(id);
    }
    if (params.length === 0) {
      out.push({ path: path + q, echoed, values });
      continue;
    }
    const { floyd, athens } = idsFor(plan);
    const fill = (id: string) =>
      path
        .replace(":processType", "civic.vote")
        .replace(":key", "copy.about")
        .replace(/:(id|processId|reviewId)/, id);
    for (const id of [...floyd, ...athens]) out.push({ path: fill(id) + q, echoed: [...echoed, id], values });
  }
  return out;
}

describe("the walk covers the app", () => {
  it("every GET route has a plan, and every plan is a real route", async () => {
    const gets = (await appRoutes()).filter((r) => r.startsWith("GET "));
    const missing = gets.filter((r) => !(r in GET_PLAN));
    expect(missing, "GET routes the leak harness does not walk: add each to GET_PLAN").toEqual([]);
    const stale = Object.keys(GET_PLAN).filter((r) => !gets.includes(r));
    expect(stale, "GET_PLAN entries for routes the app no longer mounts").toEqual([]);
  });

  it("every mutating route with an id has a plan", async () => {
    const writes = (await appRoutes()).filter((r) => !r.startsWith("GET ") && /:\w+/.test(r));
    const missing = writes.filter((r) => !(r in WRITE_PLAN));
    expect(missing, "mutating routes with an id the leak harness does not try: add each to WRITE_PLAN").toEqual([]);
  });
});

describe("GET, as Athens, with Floyd's ids", () => {
  let before: Record<string, unknown> = {};
  beforeAll(async () => {
    before = await snapshotFloyd();
  });

  it("nothing of Floyd's comes back on any GET route, signed out, as a resident or as an admin", async () => {
    const routes = Object.entries(GET_PLAN).filter(([, p]) => !p.skip);
    const requests: Array<{ label: string; path: string; token?: string; echoed: string[]; values: string[] }> = [];
    for (const [route, plan] of routes) {
      for (const { path, echoed, values } of expand(route, plan)) {
        for (const [who, token] of [["anon", undefined], ["resident", tokens.athensResident], ["admin", tokens.athensAdmin]] as const) {
          requests.push({ label: `${who} GET ${path}`, path, token, echoed, values });
        }
      }
    }
    const problems: string[] = [];
    const errors: string[] = [];
    let seenA = 0;
    await pool(requests, 12, async (r) => {
      const res = await call("GET", r.path, ATHENS, undefined, r.token);
      if (res.status >= 500) errors.push(`${r.label} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      problems.push(...leakCheck(r.label, res, r.echoed, r.values));
      if (JSON.stringify(res.body).includes(MARKER_A)) seenA += 1;
    });
    console.log(`[leak-harness] ${requests.length} GET requests as Athens (${mode}); ${seenA} returned Athens data`);
    expect(problems).toEqual([]);
    expect(errors, "a GET that fails with 5xx under this mode").toEqual([]);
    // The walk saw real data: Athens's own content came back where it should.
    expect(seenA).toBeGreaterThan(10);
  }, 240_000);

  it("the list surfaces return Athens's own content (the walk is not vacuous)", async () => {
    for (const path of ["/process", "/events?page=true&limit=200", "/feed?limit=200", `/search?q=${MARKER_A}`, `/process/${A.vote}/input`]) {
      const res = await call("GET", path, ATHENS, undefined, tokens.athensAdmin);
      expect(res.status, `Athens ${path}`).toBe(200);
      expect(JSON.stringify(res.body), path).toContain(MARKER_A);
    }
    // And Floyd's lists do have Floyd's content, so the absence above means
    // something. (Not Floyd's /process list: it does not render the minimal
    // brief and meeting-summary rows written straight into the stack above.)
    for (const path of [`/process/${B.vote}`, `/search?q=${MARKER_B}`, "/proposals", "/projects", "/brief"]) {
      const res = await call("GET", path, FLOYD, undefined, tokens.floydAdmin);
      expect(res.status, `Floyd ${path}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      expect(JSON.stringify(res.body).toLowerCase(), `Floyd ${path}`).toContain(MARKER_B);
    }
  });

  it("the walk changed none of Floyd's rows", async () => {
    expect(await snapshotFloyd()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 2. Every mutating route that names an id, with Floyd's ids

const X = { reason: "leak harness", title: `x ${MARKER_A}`, body: `x ${MARKER_A}`, description: "x" };
type WritePlan = { body?: Record<string, unknown>; skip?: string };
const WRITE_PLAN: Record<string, WritePlan> = {
  "POST /process/:id/links": { body: { to_id: "", relation: "references" } },
  "DELETE /process/:id/links/:linkId": {},
  "POST /process/:id/edit": { body: { title: X.title, description: X.description } },
  "POST /process/:id/action": { body: { type: "process.vote", payload: { option: "No" } } },
  "POST /process/:id/input": { body: { body: X.body } },
  "POST /assistant/:processType/drafts/:id/message": { body: { message: "hello" } },
  "POST /assistant/:processType/drafts/:id/review": { body: {} },
  "POST /assistant/:processType/drafts/:id/suggest": { body: {} },
  "PATCH /proposals/drafts/:id": { body: { title: X.title } },
  "POST /proposals/drafts/:id/submit": { body: {} },
  "PATCH /votes/drafts/:id": { body: { title: X.title } },
  "POST /votes/drafts/:id/submit": { body: {} },
  "PATCH /projects/drafts/:id": { body: { title: X.title } },
  "POST /projects/drafts/:id/submit": { body: {} },
  "POST /projects/:id/sentiment": { body: { sentiment: "oppose" } },
  "POST /projects/:id/complete": { body: {} },
  "PATCH /deliberations/drafts/:id": { body: { title: X.title } },
  "POST /deliberations/drafts/:id/submit": { body: {} },
  "POST /deliberations/:processId/participate/vote": { body: { tid: 0, vote: 1 } },
  "POST /deliberations/:processId/participate/statement": { body: { text: X.body } },
  "POST /deliberations/:processId/start": { body: {} },
  "POST /deliberations/:processId/close": { body: {} },
  "POST /deliberations/:processId/regenerate": { body: {} },
  "POST /proposals/:id/support": { body: {} },
  "DELETE /proposals/:id/support": {},
  "POST /reviews/:reviewId/revise": { body: { title: X.title, description: X.description } },
  "POST /reviews/:reviewId/withdraw": { body: {} },
  "POST /reviews/:reviewId/reopen": { body: {} },
  "PATCH /admin/vote-results/:id": { body: { content: { summary: X.body } } },
  "POST /admin/vote-results/:id/approve": { body: {} },
  "PATCH /admin/briefs/:id": { body: { content: { headline: X.title } } },
  "POST /admin/briefs/:id/approve": { body: {} },
  "PATCH /admin/meeting-summaries/:id": { body: { summary: X.body } },
  "POST /admin/meeting-summaries/:id/approve": { body: {} },
  "POST /admin/meeting-summaries/:id/revision/accept": { body: {} },
  "POST /admin/meeting-summaries/:id/revision/discard": { body: {} },
  "POST /admin/reviews/:reviewId/approve": { body: {} },
  "POST /admin/reviews/:reviewId/request-changes": { body: { message: X.body } },
  "POST /admin/reviews/:reviewId/decline": { body: { reason: X.reason } },
  "POST /admin/processes/:id/archive": { body: { reason: X.reason } },
  "POST /admin/processes/:id/restore": { body: {} },
  "POST /admin/queues/:queue/seen": { skip: ":queue names one of this hub's own queues, not a row; writes only the caller's hub" },
  "POST /admin/moderation/comments/:commentId/hide": { body: { reason: X.reason } },
  "POST /admin/moderation/comments/:commentId/restore": { body: {} },
  "POST /admin/moderation/announcements/:id/remove": { body: { reason: X.reason } },
  "POST /admin/moderation/announcements/:id/restore": { body: {} },
  "POST /brief/:id/response": { body: { body: X.body } },
  "PATCH /announcement/:id": { body: { title: X.title, body: X.body } },
};

describe("writes, as Athens, naming Floyd's ids", () => {
  let before: Record<string, unknown> = {};
  beforeAll(async () => {
    before = await snapshotFloyd();
  });

  it("every mutating route refuses Floyd's ids and says nothing of Floyd", async () => {
    const floydIds = idsFor({}).floyd;
    const requests: Array<{ label: string; method: string; path: string; body: unknown; token: string; echoed: string[] }> = [];
    for (const [route, plan] of Object.entries(WRITE_PLAN)) {
      if (plan.skip) continue;
      const [method, path] = route.split(" ");
      for (const id of floydIds) {
        const filled = path
          .replace(":processType", "civic.vote")
          .replace(":linkId", B.link || "no-link")
          .replace(":commentId", B.comment)
          .replace(/:(id|processId|reviewId)/, id);
        const body = plan.body && "to_id" in plan.body ? { ...plan.body, to_id: B.wordcloud } : plan.body;
        for (const [who, token] of [["admin", tokens.athensAdmin], ["resident", tokens.athensResident]] as const) {
          requests.push({ label: `${who} ${method} ${filled}`, method, path: filled, body, token, echoed: [id, B.link, B.comment, B.wordcloud] });
        }
      }
    }
    // Ids carried in the body rather than the path.
    const bodyCases = [
      { method: "POST", path: `/process/${A.vote}/links`, body: { to_id: B.vote, relation: "references" } },
      { method: "POST", path: "/admin/meeting-summaries/batch-approve", body: { ids: [B.meeting, B.brief] } },
      { method: "POST", path: "/admin/meeting-summaries/batch-delete", body: { ids: [B.meeting, B.brief] } },
      { method: "POST", path: "/process", body: { definition: { type: "civic.vote_results", version: "0.1" }, title: X.title, state: { source_process_id: B.vote } } },
    ];
    for (const c of bodyCases) {
      requests.push({ label: `admin ${c.method} ${c.path} (Floyd ids in the body)`, ...c, token: tokens.athensAdmin, echoed: [B.vote, B.meeting, B.brief] });
    }

    const problems: string[] = [];
    const accepted: string[] = [];
    const errors: string[] = [];
    await pool(requests, 8, async (r) => {
      const res = await call(r.method, r.path, ATHENS, r.body, r.token);
      problems.push(...leakCheck(r.label, res, r.echoed));
      if (res.status >= 500) errors.push(`${r.label} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      else if (res.status < 400 && !r.label.includes("in the body")) accepted.push(`${r.label} → ${res.status}`);
    });
    console.log(`[leak-harness] ${requests.length} cross-hub writes as Athens (${mode})`);
    expect(problems).toEqual([]);
    expect(accepted, "a write naming a Floyd id that Athens's request did not refuse").toEqual([]);
    expect(errors, "a cross-hub write that failed with 5xx instead of a refusal").toEqual([]);
  }, 240_000);

  it("Floyd's rows are exactly as they were", async () => {
    expect(await snapshotFloyd()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 3. The digest, in-process, in the same mode as the server

describe("the digest", () => {
  it("Athens's digest carries Athens's news and nothing of Floyd's", async () => {
    const { url, key } = localStack();
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    process.env.DIGEST_UNSUBSCRIBE_SECRET = DIGEST_SECRET;
    if (mode === "hub_token") {
      process.env.CIVIC_HUB_MINTED_TOKEN = "true";
      process.env.CIVIC_HUB_SIGNING_KEY ??= LOCAL_JWT_SECRET;
      process.env.SUPABASE_PUBLISHABLE_KEY ??= LOCAL_PUBLISHABLE_KEY;
    } else {
      process.env.CIVIC_HUB_MINTED_TOKEN = "false";
    }
    const { hubDbMode } = await import("../../src/db/forHub.js");
    expect(hubDbMode()).toBe(mode);
    const { getHubBySlug } = await import("../../src/db/hubs.js");
    const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
    const { runWithHub } = await import("../../src/config/hubContext.js");
    const { runDigestForHub } = await import("../../src/controllers/digestController.js");

    const hub = await getHubBySlug("athens");
    expect(hub).toBeTruthy();
    const settings = await fetchHubSettings("athens");
    mailbox.length = 0;
    const outcome = await runWithHub(hub!, settings, () => runDigestForHub({ now: new Date(), force: true }));
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);

    const mine = mailbox.filter((m) => m.to.includes(MARKER_A));
    expect(mine.length, `digest recipients: ${mailbox.map((m) => m.to).join(", ")}`).toBe(1);
    const text = `${mine[0].subject}\n${mine[0].html}\n${mine[0].text}`;
    expect(text).toContain(MARKER_A);
    for (const m of mailbox) {
      expect(leakCheck(`digest to ${m.to}`, { status: 200, body: `${m.subject}\n${m.html}\n${m.text}` })).toEqual([]);
    }
  }, 60_000);
});
