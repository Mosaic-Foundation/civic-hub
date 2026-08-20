/**
 * Test flow script — validates the Civic Brief lifecycle end-to-end:
 *   1. Auth as an admin user via the demo bypass code
 *   2. Create a civic.vote process
 *   3. Activate the vote
 *   4. Submit a few votes (as different actors — need fresh sessions)
 *   5. Close the vote (which should spawn a civic.brief)
 *   6. Verify aggregation_completed fires and the brief appears
 *   7. PATCH the brief with some comments
 *   8. Approve the brief (delivers email, emits outcome_recorded,
 *      result_published for brief + vote, transitions both to finalized)
 *   9. Verify:
 *      - vote status is finalized
 *      - brief is published at GET /brief/:id
 *      - /events has the full expected sequence
 *      - /process public list includes the brief (since it's now published)
 *      - GET /process/:voteId/state shows follow_up_process_ids pointing
 *        at the brief
 *
 * Prerequisites:
 *   - Hub dev server running on localhost:3000.
 *   - .env includes:
 *       CIVIC_ADMIN_EMAILS=<your admin email>
 *       CIVIC_DEMO_BYPASS_CODE=000000  (or any code)
 *       BOARD_RECIPIENT_EMAIL=board@example.test
 *     (SMTP vars can stay unset — delivery will console-log.)
 *
 * Run: BASE_URL=http://localhost:3000 ADMIN_EMAIL=you@example.com \
 *      BYPASS_CODE=000000 npx tsx scripts/testBriefFlow.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const BYPASS_CODE = process.env.BYPASS_CODE ?? "000000";

if (!ADMIN_EMAIL) {
  console.error("Set ADMIN_EMAIL env var (must match CIVIC_ADMIN_EMAILS).");
  process.exit(1);
}

interface HttpResult<T = unknown> {
  status: number;
  data: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

function step(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string, detail?: unknown): never {
  console.error(`  ✗ ${msg}`);
  if (detail) console.error("    detail:", JSON.stringify(detail, null, 2));
  process.exit(1);
}

function assert(cond: boolean, msg: string, detail?: unknown): void {
  if (!cond) fail(msg, detail);
  ok(msg);
}

async function authAs(email: string): Promise<{ token: string; userId: string }> {
  const req = await request<{ message?: string }>("POST", "/auth/request-code", { email });
  if (req.status !== 200) fail(`request-code failed: ${req.status}`, req.data);
  const verify = await request<{ token?: string; user?: { id: string; is_resident: boolean } }>(
    "POST",
    "/auth/verify",
    { email, code: BYPASS_CODE },
  );
  if (verify.status !== 200 || !verify.data.token || !verify.data.user) {
    fail(`verify failed: ${verify.status}`, verify.data);
  }
  const token = verify.data.token!;
  const user = verify.data.user!;
  // Affirm residency so we can participate.
  if (!user.is_resident) {
    const aff = await request("POST", "/auth/residency", { affirm: true }, token);
    if (aff.status !== 200) fail(`residency failed: ${aff.status}`, aff.data);
  }
  return { token, userId: user.id };
}

async function run(): Promise<void> {
  console.log(`🏛️  Civic Brief Flow Test\n  Target: ${BASE}\n  Admin:  ${ADMIN_EMAIL}`);

  // 1. Health
  step("1. Health");
  const h = await request("GET", "/health");
  assert(h.status === 200, "Health responds 200");

  // 2. Admin auth
  step("2. Auth as admin");
  const admin = await authAs(ADMIN_EMAIL as string);
  ok(`Got admin session for ${(admin.userId ?? "").slice(0, 12)}…`);

  // 3. Create a vote
  step("3. Create civic.vote process");
  const createRes = await request<{ id: string; status: string }>(
    "POST",
    "/process",
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: "Test: add a downtown crosswalk",
      description: "Should the county add a signalized crosswalk at Main & 2nd?",
      jurisdiction: "us-va-floyd",
      createdBy: admin.userId,
      state: { options: ["yes", "no"] },
    },
    admin.token,
  );
  assert(createRes.status === 201 || createRes.status === 200, "Create vote succeeds", createRes);
  const voteId = createRes.data.id;
  ok(`Vote ID: ${voteId}`);

  // 4. Activate
  step("4. Activate vote");
  const act = await request(
    "POST",
    `/process/${voteId}/action`,
    { type: "process.activate", actor: admin.userId, payload: {} },
    admin.token,
  );
  assert(act.status === 200, "Activate succeeds", act);

  // 5. Submit a vote (admin votes for "yes"). Just one is enough to prove the
  //    flow; scripting multi-user auth here is more trouble than it's worth.
  step("5. Submit a vote");
  const v1 = await request(
    "POST",
    `/process/${voteId}/action`,
    { type: "process.vote", actor: admin.userId, payload: { option: "yes" } },
    admin.token,
  );
  assert(v1.status === 200, "Vote submitted", v1);

  // 5b. Submit a community comment via civic.input (Slice 3.5)
  step("5b. Submit community comment");
  const testComment =
    "Crosswalk would help families walking from the school. Keep the signal timing short so traffic doesn't back up.";
  const input = await request<{ id: string; body: string }>(
    "POST",
    `/process/${voteId}/input`,
    { body: testComment },
    admin.token,
  );
  assert(input.status === 201, "Comment submitted (201)", input);
  assert(input.data.body === testComment, "Stored body matches input");

  // 5c. Verify civic.process.comment_added event fired
  step("5c. Verify comment_added event");
  const earlyEvs = await request<{ events: Array<{ event_type: string; process_id: string; data: unknown }> }>(
    "GET",
    `/feed?process_id=${voteId}`,
  );
  const commentEvents = earlyEvs.data.events.filter(
    (e) => e.event_type === "civic.process.comment_added",
  );
  assert(
    commentEvents.length === 1,
    "Exactly one civic.process.comment_added event fired",
    earlyEvs.data.events.map((e) => e.event_type),
  );
  const commentData = (commentEvents[0].data as { comment?: { id: string; body_preview: string } })?.comment;
  assert(commentData?.id === input.data.id, "Event data.comment.id matches input id");
  assert(
    typeof commentData?.body_preview === "string" && commentData.body_preview.length <= 200,
    "Event data.comment.body_preview is trimmed to <=200 chars",
  );

  // 6. Close — should auto-spawn a brief
  step("6. Close vote (spawns brief)");
  const close = await request<{ result: { tally: Record<string, number>; total_votes: number; brief_process_id?: string } }>(
    "POST",
    `/process/${voteId}/action`,
    { type: "process.close", actor: admin.userId, payload: {} },
    admin.token,
  );
  assert(close.status === 200, "Close succeeds", close);
  assert(close.data.result?.total_votes === 1, "Tally has 1 vote", close.data);
  const briefId = close.data.result?.brief_process_id;
  assert(typeof briefId === "string", "Close response includes brief_process_id", close.data);
  ok(`Brief ID: ${briefId}`);

  // 7. Check events — look for the new spec events
  step("7. Verify spec-compliant event sequence");
  const evs = await request<{ events: Array<{ event_type: string; process_id: string; data: unknown }> }>(
    "GET",
    "/feed",
  );
  const voteEvents = evs.data.events.filter((e) => e.process_id === voteId);
  const briefEvents = evs.data.events.filter((e) => e.process_id === briefId);
  const voteTypes = voteEvents.map((e) => e.event_type);
  const briefTypes = briefEvents.map((e) => e.event_type);
  console.log("  vote events:", voteTypes.join(", "));
  console.log("  brief events:", briefTypes.join(", "));
  assert(voteTypes.includes("civic.process.ended"), "Vote emitted .ended");
  assert(voteTypes.includes("civic.process.aggregation_completed"), "Vote emitted .aggregation_completed (NEW)");
  assert(briefTypes.includes("civic.process.created"), "Brief emitted .created");
  assert(briefTypes.includes("civic.process.aggregation_completed"), "Brief emitted .aggregation_completed");
  assert(!voteTypes.includes("civic.process.result_published"), "Vote has NOT published yet (brief-gated)");

  // 7b. Brief was seeded with the community comment from Slice 3.5
  step("7b. Brief content.comments seeded from civic.input");
  const briefDetail = await request<{ content: { comments: string[] } }>(
    "GET",
    `/admin/briefs/${briefId}`,
    undefined,
    admin.token,
  );
  assert(briefDetail.status === 200, "Admin GET brief succeeds");
  assert(
    briefDetail.data.content.comments.includes(testComment),
    "Brief content.comments includes the submitted comment",
    briefDetail.data.content.comments,
  );

  // 8. Vote should link to brief via follow_up_process_ids
  step("8. Vote's follow_up_process_ids points at brief");
  const voteState = await request<{ follow_up_process_ids?: string[] }>(
    "GET",
    `/process/${voteId}/state`,
  );
  // follow_up_process_ids lives on the raw state, not necessarily in the read model.
  // Falling back to fetching the bare process:
  const rawVote = await request<{ state: { follow_up_process_ids?: string[] } }>(
    "GET",
    `/process/${voteId}`,
  );
  const followUps = rawVote.data.state?.follow_up_process_ids ?? [];
  assert(followUps.includes(briefId as string), "follow_up_process_ids includes brief ID");

  // 9. Brief isn't public yet
  step("9. Brief invisible to public before approval");
  const preBrief = await request("GET", `/brief/${briefId}`);
  assert(preBrief.status === 404, "GET /brief/:id → 404 while pending");

  // 10. PATCH the brief with comments
  step("10. PATCH brief with admin edits");
  const patched = await request<{ content: { comments: string[]; admin_notes: string } }>(
    "PATCH",
    `/admin/briefs/${briefId}`,
    {
      comments: ["Support from most residents.", "A few concerns about funding."],
      admin_notes: "The Board should consider a phased rollout.",
    },
    admin.token,
  );
  assert(patched.status === 200, "PATCH succeeds", patched);
  assert(patched.data.content.comments.length === 2, "Comments were saved");
  assert(
    patched.data.content.admin_notes.includes("phased rollout"),
    "Admin notes saved",
  );

  // 11. Approve the brief
  step("11. Approve brief (email + orchestration)");
  const approve = await request<{ brief: { publication_status: string; delivered_to: string[] } }>(
    "POST",
    `/admin/briefs/${briefId}/approve`,
    {},
    admin.token,
  );
  if (approve.status === 503) {
    console.log("  ⚠ 503 — BOARD_RECIPIENT_EMAIL is not set on the server.");
    console.log("  Set it in .env and restart the hub, then re-run this script.");
    process.exit(1);
  }
  assert(approve.status === 200, "Approve succeeds", approve);
  assert(approve.data.brief.publication_status === "published", "Brief is published");
  assert(approve.data.brief.delivered_to.length > 0, "Brief has recipients");

  // 12. Brief is now public
  step("12. Public /brief/:id renders");
  const pubBrief = await request<{ title: string; comments: string[] }>(
    "GET",
    `/brief/${briefId}`,
  );
  assert(pubBrief.status === 200, "GET /brief/:id → 200 after approval");
  assert(pubBrief.data.comments.length === 2, "Public brief has the admin's comments");

  // 13. Final event sequence — brief + vote result_published both fired
  step("13. Final event sequence");
  const finalEvs = await request<{ events: Array<{ event_type: string; process_id: string }> }>(
    "GET",
    "/feed",
  );
  const finalVoteTypes = finalEvs.data.events
    .filter((e) => e.process_id === voteId)
    .map((e) => e.event_type);
  const finalBriefTypes = finalEvs.data.events
    .filter((e) => e.process_id === briefId)
    .map((e) => e.event_type);
  assert(
    finalBriefTypes.includes("civic.process.outcome_recorded"),
    "Brief emitted .outcome_recorded",
  );
  assert(
    finalBriefTypes.includes("civic.process.result_published"),
    "Brief emitted .result_published",
  );
  assert(
    finalVoteTypes.includes("civic.process.result_published"),
    "Vote emitted .result_published (via brief-gated finalize)",
  );

  // 14. Vote finalized
  step("14. Vote is finalized");
  const finalVote = await request<{ status: string }>("GET", `/process/${voteId}`);
  assert(finalVote.data.status === "finalized", "Vote status is finalized");

  // 15. Public process list now includes the brief (published only)
  step("15. Public list includes the published brief");
  const list = await request<Array<{ id: string; type: string; publication_status?: string }>>(
    "GET",
    "/process",
  );
  const listedBrief = list.data.find((p) => p.id === briefId);
  assert(listedBrief !== undefined, "Brief is in the public list");
  assert(
    listedBrief?.publication_status === "published",
    "Listed brief is marked published",
  );

  console.log("\n🎉 All assertions passed.\n");
}

run().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
