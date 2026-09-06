import { Request, Response } from "express";
import type { Process } from "../models/process.js";
import { emitEvent } from "../events/eventEmitter.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../config/hub.js";
import {
  getAuthUser,
  resolveCallerUser,
  isAdminEmail,
} from "../middleware/auth.js";
import { buildProcessAnonNumbers } from "../services/processAnonymity.js";
import {
  createProject,
  listProjects,
  getProject,
  getProjectReadModel,
  getProjectSummary,
  setProjectSentiment,
  completeProject,
} from "../modules/civic.projects/index.js";
import type { SentimentValue } from "../modules/civic.projects/models.js";
import { enrichCreator, enrichCreators } from "../services/creatorDisplay.js";
import { getProcess } from "../services/processService.js";
import {
  spawnBriefFromClosedProcess,
  findExistingBriefId,
} from "../processes/spawnBrief.js";

/**
 * POST /projects/:id/complete — mark a project complete (creator or admin).
 * Transitions the project to completed and spawns its Civic Brief (pending
 * admin review), like every other process's close.
 */
export async function handleCompleteProject(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const id = req.params.id as string;
    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.user_id !== user.id && !isAdminEmail(user.email)) {
      res.status(403).json({ error: "Only the project creator or an admin can complete this project." });
      return;
    }

    await completeProject(id, user.id, emitEvent);

    // Spawn the brief (projects don't run through executeAction). A project
    // may not have a canonical processes row (createProject only writes the
    // projects table), so build the source Process from the project data
    // rather than relying on getProcess.
    try {
      if (!(await findExistingBriefId(id))) {
        const existing = await getProcess(id);
        const source: Process = existing ?? {
          id,
          definition: { type: "civic.project", version: "0.1" },
          title: project.title,
          description: project.description ?? "",
          status: "closed",
          hubId: HUB_ID,
          jurisdiction: DEFAULT_JURISDICTION,
          createdBy: project.user_id,
          createdAt: project.created_at,
          updatedAt: new Date().toISOString(),
          state: {},
        };
        await spawnBriefFromClosedProcess(source, user.id);
      }
    } catch (err) {
      console.warn(
        `[brief] spawn on project completion ${id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    res.json({
      ok: true,
      message: "Project marked complete. A brief was created for admin review.",
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

export async function handleCreateProject(
  req: Request,
  res: Response,
): Promise<void> {
  const { title, description, sources, assistant_helped } = req.body;

  if (!title) {
    res.status(400).json({ error: "Missing required field: title" });
    return;
  }

  try {
    const user = getAuthUser(res);
    const project = await createProject(
      { title, description, sources, user_id: user.id, assistant_helped },
      emitEvent,
    );
    res.status(201).json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleListProjects(
  req: Request,
  res: Response,
): Promise<void> {
  const status = req.query.status as string | undefined;
  const validStatuses = ["active", "archived"];

  if (status && !validStatuses.includes(status)) {
    res.status(400).json({
      error: `Invalid status filter. Valid values: ${validStatuses.join(", ")}`,
    });
    return;
  }

  try {
    const projects = await listProjects(status as any);
    const summaries = projects.map(getProjectSummary);
    // Resolve every creator in one query; attach name + admin flag and
    // redact the raw user_id from this public list. Cross-process list
    // surface: public callers see plain "Resident" (no number).
    const enriched = await enrichCreators(summaries, {
      rawIdField: "user_id",
      audience: (await resolveCallerUser(req)) ? "member" : "public",
    });
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetProject(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  // Caller identity comes from the session token, never from ?actor= (which
  // let anyone read another user's sentiment by passing their id). Anonymous
  // callers get the public read model with no per-actor fields.
  const caller = await resolveCallerUser(req);
  const callerId = caller?.id;

  try {
    const readModel = await getProjectReadModel(id, callerId);
    if (!readModel) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    // Owner edit-affordance is a server-computed boolean, so the raw user_id
    // never leaves the API. enrichCreator redacts user_id (keepRawId omitted).
    const isOwner =
      !!callerId && (readModel as { user_id?: string }).user_id === callerId;
    const enriched = await enrichCreator(readModel, {
      rawIdField: "user_id",
      audience: caller ? "member" : "public",
      anonNumbers: caller ? undefined : await buildProcessAnonNumbers(id),
    });
    enriched.is_owner = isOwner;
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}


export async function handleSetSentiment(
  req: Request,
  res: Response,
): Promise<void> {
  const projectId = req.params.id as string;
  const { sentiment } = req.body;

  const validSentiments = ["support", "oppose", "neutral"];
  if (!sentiment || !validSentiments.includes(sentiment)) {
    res.status(400).json({
      error: `sentiment must be one of: ${validSentiments.join(", ")}`,
    });
    return;
  }

  try {
    const user = getAuthUser(res);
    const result = await setProjectSentiment(
      projectId,
      user.id,
      sentiment as SentimentValue | "neutral",
      emitEvent,
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
}


