import type { Request, Response } from "express";
import { getAuthUser, resolveCallerId } from "../middleware/auth.js";
import { getPolisAdapter } from "../processes/deliberationBoot.js";
import { getDb } from "../db/client.js";
import * as processService from "../services/processService.js";
import type { PolisDeliberationState } from "../shared/polis_deliberation/types.js";
import type { VoteDirection } from "../shared/polis_deliberation/adapter/types.js";
import {
  isSeedConversation,
  getMockClusters,
  getMockNextStatement,
  advanceMockStatement,
  addMockStatement,
} from "../debug/seedDeliberationMocks.js";
import { submitAsCreator } from "../modules/civic.review/index.js";
import { assertPassesWordlist } from "../shared/wordlist/index.js";

async function getConversationId(processId: string): Promise<string> {
  const process = await processService.getProcess(processId);
  if (!process) {
    throw new Error(`Process "${processId}" not found`);
  }
  if (process.status !== "active") {
    throw new Error("Conversation is not active");
  }
  const state = process.state as unknown as PolisDeliberationState;
  if (!state.polis_conversation_id) {
    throw new Error("Conversation has not been started");
  }
  return state.polis_conversation_id;
}

export async function vote(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const processId = req.params.processId as string;
    const { statement_id, vote: direction } = req.body;

    if (typeof statement_id !== "number" || !direction) {
      res.status(400).json({ error: "statement_id (number) and vote (agree|disagree|pass) are required" });
      return;
    }

    const validVotes: VoteDirection[] = ["agree", "disagree", "pass"];
    if (!validVotes.includes(direction)) {
      res.status(400).json({ error: "vote must be agree, disagree, or pass" });
      return;
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
      await getDb()
        .from("deliberation_votes")
        .upsert({ process_id: processId, user_id: user.id, statement_id });
    } catch {
      // Non-critical — don't fail the vote if local tracking fails
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function submitStatement(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const processId = req.params.processId as string;
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    // Egregious-slur pre-filter (see src/shared/wordlist), applied BEFORE the
    // statement is forwarded to Polis (and before the seed/mock branch below),
    // since Polis has no visibility into our Code of Conduct. Civil dissent
    // passes through untouched.
    assertPassesWordlist(text);

    const { data: existing } = await getDb()
      .from("deliberation_submissions")
      .select("user_id")
      .eq("process_id", processId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: "You have already submitted a statement in this conversation" });
      return;
    }

    const conversationId = await getConversationId(processId);

    // Seed conversations use mock data
    if (isSeedConversation(conversationId)) {
      const stmt = addMockStatement(conversationId, text.trim());
      await getDb()
        .from("deliberation_submissions")
        .upsert({ process_id: processId, user_id: user.id });
      res.status(201).json(stmt ?? { id: 0, text: text.trim() });
      return;
    }

    const adapter = getPolisAdapter();
    const result = await adapter.submitStatement(conversationId, user.id, text.trim());
    await getDb()
      .from("deliberation_submissions")
      .upsert({ process_id: processId, user_id: user.id });
    res.status(201).json(result);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function getNextStatement(req: Request, res: Response): Promise<void> {
  try {
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
      const { data: votes } = await getDb()
        .from("deliberation_votes")
        .select("statement_id")
        .eq("process_id", processId)
        .eq("user_id", user.id);

      const votedIds = new Set((votes ?? []).map((v: { statement_id: number }) => v.statement_id));

      // If zero votes, definitely a new participant. If some votes,
      // check for unvoted statements in case Polis lost track.
      const allStatements = await adapter.getStatements(conversationId);
      const unvoted = allStatements.filter((s) => !votedIds.has(s.id));

      if (unvoted.length > 0) {
        statement = unvoted[0];
      }
    }

    res.json({ statement });
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function getClusterState(req: Request, res: Response): Promise<void> {
  try {
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
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function handleCreateDeliberation(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const { title, description, topic, framing, deadline, participation_threshold, seed_statements } = req.body;

    if (!topic || !framing) {
      res.status(400).json({ error: "topic and framing are required" });
      return;
    }

    const statePayload: Record<string, unknown> = {
      topic,
      framing,
      ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      ...(participation_threshold ? { participation_threshold: parseInt(participation_threshold, 10) } : {}),
      ...(seed_statements?.length ? { seed_statements } : {}),
    };

    // One creation path: always submit for review; admins are auto-approved.
    const result = await submitAsCreator(
      {
        process_type: "civic.polis_deliberation",
        title: title || topic,
        description: description || framing,
        creator_id: user.id,
        creator_name: user.full_name || user.display_name || "Resident",
        creator_email: user.email,
        state: statePayload,
      },
      user.email,
    );

    res.status(201).json(result);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function handleStartDeliberation(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const processId = req.params.processId as string;

    const result = await processService.executeAction(processId, {
      type: "start",
      actor: user.id,
      payload: {},
    });

    res.json(result);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function closeDeliberation(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const processId = req.params.processId as string;

    const result = await processService.executeAction(processId, {
      type: "close",
      actor: user.id,
      payload: {},
    });

    res.json(result);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function regenerateSummary(req: Request, res: Response): Promise<void> {
  try {
    const user = getAuthUser(res);
    const processId = req.params.processId as string;

    const result = await processService.executeAction(processId, {
      type: "regenerate_summary",
      actor: user.id,
      payload: {},
    });

    res.json(result);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function listDeliberations(_req: Request, res: Response): Promise<void> {
  try {
    const all = await processService.getAllProcesses();
    const deliberations = all.filter(
      (p) => p.definition.type === "civic.polis_deliberation",
    );
    const handler = (await import("../processes/registry.js")).getProcessHandler(
      "civic.polis_deliberation",
    );
    if (!handler) {
      res.json([]);
      return;
    }
    const summaries = deliberations.map((p) => handler.getSummary(p));
    res.json(summaries);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function getDeliberation(req: Request, res: Response): Promise<void> {
  try {
    const processId = req.params.processId as string;
    const process = await processService.getProcess(processId);
    if (!process || process.definition.type !== "civic.polis_deliberation") {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const handler = (await import("../processes/registry.js")).getProcessHandler(
      "civic.polis_deliberation",
    );
    if (!handler) {
      res.status(404).json({ error: "Conversation handler not registered" });
      return;
    }
    // Caller identity comes from the session token, never from ?actor= (which
    // let anyone read another resident's participation state by passing their
    // id). Anonymous callers get the public read model.
    const actor = await resolveCallerId(req);
    const readModel = handler.getReadModel(process, actor);

    let has_submitted = false;
    if (actor) {
      const { data } = await getDb()
        .from("deliberation_submissions")
        .select("user_id")
        .eq("process_id", processId)
        .eq("user_id", actor)
        .maybeSingle();
      has_submitted = !!data;
    }

    res.json({ ...readModel, has_submitted });
  } catch (err: any) {
    handleError(res, err);
  }
}

function handleError(res: Response, err: any): void {
  const msg = err.message ?? "Internal error";
  if (msg.includes("not found")) {
    res.status(404).json({ error: msg });
  } else if (msg.includes("not active") || msg.includes("not been started")) {
    res.status(409).json({ error: msg });
  } else {
    res.status(500).json({ error: msg });
  }
}
