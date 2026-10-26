import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AiLimitError,
  route,
  getActor,
  getAuthUser,
  can,
  executeAction,
  getAllProcesses,
  getProcess,
  readsAsClosed,
  isSeedConversation,
  getMockClusters,
  getMockNextStatement,
  advanceMockStatement,
  addMockStatement,
  submitAsCreator,
  reviewMailbox,
  checkTextAgainstCoC,
  getHubConfig,
  personFallbackName,
  readAsPage,
  viewFor,
  getProcessHandler,
  briefIdForSource,
  regenerateBrief,
} from "../../src/sdk/index.js";
import { getPolisAdapter } from "./boot.js";
import { conversationHost } from "./host.js";
import {
  findExistingSubmission,
  getVotedStatementIds,
  recordLocalVoteTracking,
  recordSubmission,
} from "./votes.js";
import type { PolisDeliberationState } from "./types.js";
import type { VoteDirection } from "./adapter/types.js";
import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";


async function getConversationId(processId: string): Promise<string> {
  const process = await getProcess(processId);
  if (!process) throw new NotFoundError("Conversation not found");
  // Past its deadline it reads as closed until the hourly job closes it, so
  // it takes no more statements or votes in the meantime.
  if (process.status !== "active" || (await readsAsClosed(process))) {
    throw new ConflictError("Conversation is not active", "conversation_not_active");
  }
  const state = process.state as unknown as PolisDeliberationState;
  if (!state.polis_conversation_id) {
    throw new ConflictError("Conversation has not been started", "conversation_not_started");
  }
  return state.polis_conversation_id;
}

export const vote = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;
  const { statement_id, vote: direction } = req.body;

  if (typeof statement_id !== "number" || !direction) {
    throw new ValidationError("statement_id (number) and vote (agree|disagree|pass) are required");
  }

  const validVotes: VoteDirection[] = ["agree", "disagree", "pass"];
  if (!validVotes.includes(direction)) {
    throw new ValidationError("vote must be agree, disagree, or pass");
  }

  const conversationId = await getConversationId(processId);

  // Seed conversations use mock data — no Polis API call
  if (isSeedConversation(conversationId)) {
    advanceMockStatement(conversationId, user.id);
    res.json({ ok: true });
    return;
  }

  const adapter = getPolisAdapter();
  await adapter.recordVote(conversationId, user.id, statement_id, direction);

  // Track vote locally so we can distinguish new participants from
  // users who have voted on everything (Polis returns null for both).
  try {
    await recordLocalVoteTracking(processId, user.id, statement_id);
  } catch {
    // Non-critical — don't fail the vote if local tracking fails
  }

  res.json({ ok: true });
});

export const submitStatement = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;
  const { text } = req.body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new ValidationError("text is required");
  }

  // Egregious-slur pre-filter (see src/shared/wordlist), applied BEFORE the
  // statement is forwarded to Polis (and before the seed/mock branch below),
  // since Polis has no visibility into our Code of Conduct. Civil dissent
  // passes through untouched.
  assertPassesWordlist(text);

  const existing = await findExistingSubmission(processId, user.id);

  if (existing) {
    throw new ConflictError("You have already submitted a statement in this conversation", "already_submitted");
  }

  const conversationId = await getConversationId(processId);

  // Seed conversations use mock data
  if (isSeedConversation(conversationId)) {
    const stmt = addMockStatement(conversationId, text.trim());
    await recordSubmission(processId, user.id);
    res.status(201).json(stmt ?? { id: 0, text: text.trim() });
    return;
  }

  const adapter = getPolisAdapter();
  const result = await adapter.submitStatement(conversationId, user.id, text.trim());
  await recordSubmission(processId, user.id);
  res.status(201).json(result);
});

export const getNextStatement = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;

  const conversationId = await getConversationId(processId);

  // Seed conversations use mock data
  if (isSeedConversation(conversationId)) {
    const statement = getMockNextStatement(conversationId, user.id);
    res.json({ statement });
    return;
  }

  const adapter = getPolisAdapter();
  let statement = await adapter.getNextStatement(conversationId, user.id);

  // If Polis returned nothing, check whether this user has ever voted.
  // New participants aren't registered with Polis yet, so nextComment
  // returns null even though there ARE statements. For those users,
  // fall back to serving unvoted statements from the full list.
  if (!statement) {
    const votedIds = await getVotedStatementIds(processId, user.id);

    // If zero votes, definitely a new participant. If some votes,
    // check for unvoted statements in case Polis lost track.
    const allStatements = await adapter.getStatements(conversationId);
    const unvoted = allStatements.filter((s) => !votedIds.has(s.id));

    if (unvoted.length > 0) {
      statement = unvoted[0];
    }
  }

  res.json({ statement });
});

export const getClusterState = route(async (req, res) => {
  const processId = req.params.processId as string;
  const conversationId = await getConversationId(processId);

  // Seed conversations use mock data
  if (isSeedConversation(conversationId)) {
    const clusters = getMockClusters(conversationId);
    if (clusters) {
      res.json(clusters);
    } else {
      res.json({ participant_count: 0, statement_count: 0, math_tick: 0, groups: [], consensus: { agree: [], disagree: [] } });
    }
    return;
  }

  const adapter = getPolisAdapter();
  const clusters = await adapter.pullClusterState(conversationId);
  res.json(clusters);
});

export const handleCreateDeliberation = route(async (req, res) => {
  const user = getAuthUser(res);
  const { title, description, topic, framing, deadline, duration_ms, participation_threshold, seed_statements, sources } = req.body;

  if (!topic || !framing) {
    throw new ValidationError("topic and framing are required");
  }

  const statePayload: Record<string, unknown> = {
    topic,
    framing,
    // Either an explicit deadline or a duration (deadline computed when
    // the conversation starts). The drafting UI sends duration_ms; the
    // deadline form stays supported for direct API callers.
    ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
    ...(Number.isFinite(Number(duration_ms)) && Number(duration_ms) > 0
      ? { duration_ms: Number(duration_ms) }
      : {}),
    ...(participation_threshold ? { participation_threshold: parseInt(participation_threshold, 10) } : {}),
    ...(seed_statements?.length ? { seed_statements } : {}),
    ...(Array.isArray(sources) && sources.length ? { sources } : {}),
  };

  // The always-on automated Code of Conduct check. Conversations have no
  // drafting flow (and no assistant), so the check runs here at submission
  // instead of on a draft. Hard findings block; an unavailable checker
  // fails open to human admin review, same as the draft flows.
  let cocPassed = false;
  try {
    // Counted like the drafts' check (Audit 2): over the hourly count is a
    // 429; a spent hub budget falls through to "unavailable" below.
    await conversationHost.get().adapter("ai").admit("review", user.id);
    const findings = await checkTextAgainstCoC(
      [
        { label: "Topic", text: String(topic) },
        { label: "Framing", text: String(framing) },
        ...(Array.isArray(seed_statements) && seed_statements.length
          ? [{ label: "Seed statements", text: seed_statements.join("\n") }]
          : []),
      ],
      await getHubConfig(),
    );
    if (findings.length > 0) {
      res.status(400).json({
        error:
          "This conversation can't be submitted yet — the automated Code of Conduct check flagged: " +
          findings.map((f) => f.message).join(" "),
        code: "coc_flagged",
        coc_findings: findings,
      });
      return;
    }
    cocPassed = true;
  } catch (cocErr) {
    if (cocErr instanceof AiLimitError && !cocErr.budget) {
      throw cocErr;
    }
    console.error(
      "[deliberation-coc] automated check unavailable, failing open to human review:",
      cocErr instanceof Error ? cocErr.message : cocErr,
    );
  }

  // One creation path: always submit for review; admins are auto-approved.
  const result = await submitAsCreator(
    {
      process_type: "civic.polis_deliberation",
      title: title || topic,
      description: description || framing,
      creator_id: user.id,
      creator_name: user.full_name || user.display_name || personFallbackName(),
      creator_email: reviewMailbox(user.email),
      state: statePayload,
    },
    { cocPassed, creatorIsAdmin: await can(getActor(res), "hub.administer") },
  );

  res.status(201).json(result);
});

// Admin actions answer like every action: { result, view } (never the raw row).
export const handleStartDeliberation = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;

  const result = await executeAction(processId, {
    type: "start",
    actor: user.id,
    payload: {},
  }, "admin");

  res.json({ result: result.result, view: await viewFor(res, processId) });
});

export const closeDeliberation = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;

  // Before its deadline, the close needs the admin's note (Close early).
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  const result = await executeAction(processId, {
    type: "close",
    actor: user.id,
    payload: note === undefined ? {} : { note },
  }, "admin");

  res.json({ result: result.result, view: await viewFor(res, processId) });
});

// The summary is its brief's since plugin session 2: making it again is the
// brief's Regenerate (replaced while the brief is unpublished, staged once it
// is published). Kept here so an admin's older link still works.
export const regenerateSummary = route(async (req, res) => {
  const user = getAuthUser(res);
  const processId = req.params.processId as string;
  const briefId = await briefIdForSource(processId);
  if (!briefId) throw new ConflictError("This conversation has no brief yet; its summary is made with the brief.", "no_brief");
  const { staged } = await regenerateBrief(briefId, { id: user.id, email: user.email ?? null });

  res.json({ result: { staged, brief_id: briefId }, view: await viewFor(res, processId) });
});

export const listDeliberations = route(async (_req, res) => {
  // Type-filtered in SQL — this list was fetching every process's full
  // state JSONB to keep five conversations (perf pass, 2026-08-28).
  const deliberations = await getAllProcesses([
    "civic.polis_deliberation",
  ]);
  const handler = getProcessHandler("civic.polis_deliberation");
  if (!handler) {
    res.json([]);
    return;
  }
  const summaries = deliberations.map((p) => {
    const summary = handler.getSummary(p);
    return p.isSample ? { ...summary, is_sample: true } : summary;
  });
  res.json(summaries);
});

export const getDeliberation = route(async (req, res) => {
  // The shared read path (visibility, bylines, sample badge), with the
  // conversation's own fields from its handler, has_submitted included.
  res.json(await readAsPage(req, req.params.processId as string, "civic.polis_deliberation", "Conversation not found"));
});
