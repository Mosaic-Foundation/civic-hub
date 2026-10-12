import { ForbiddenError, NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Process } from "../models/process.js";
import { emitEvent } from "../events/eventEmitter.js";
import { defaultJurisdiction } from "../config/hub.js";
import { currentHubId } from "../config/hubContext.js";
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
import { getProcess, getSampleProcessIds } from "../services/processService.js";
import {
  spawnBriefFromClosedProcess,
  findExistingBriefId,
} from "../processes/spawnBrief.js";

/**
 * POST /projects/:id/complete — mark a project complete (creator or admin).
 * Transitions the project to completed and spawns its Civic Brief (pending
 * admin review), like every other process's close.
 */
export const handleCompleteProject = route(async (req, res) => {
  const user = getAuthUser(res);
  const id = req.params.id as string;
  const project = await getProject(id);
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  if (project.user_id !== user.id && !isAdminEmail(user.email)) {
    throw new ForbiddenError("Only the project creator or an admin can complete this project.");
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
        hubId: currentHubId(),
        jurisdiction: defaultJurisdiction(),
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
});

export const handleCreateProject = route(async (req, res) => {
  const { title, description, sources, assistant_helped } = req.body;

  if (!title) {
    throw new ValidationError("Missing required field: title");
  }

  const user = getAuthUser(res);
  const project = await createProject(
    { title, description, sources, user_id: user.id, assistant_helped },
    emitEvent,
  );
  res.status(201).json(project);
});

export const handleListProjects = route(async (req, res) => {
  const status = req.query.status as string | undefined;
  const validStatuses = ["active", "archived"];

  if (status && !validStatuses.includes(status)) {
    throw new ValidationError(`Invalid status filter. Valid values: ${validStatuses.join(", ")}`);
  }

  const projects = await listProjects(status as any);
  const summaries = projects.map(getProjectSummary);
  // Resolve every creator in one query; attach name + admin flag and
  // redact the raw user_id from this public list. Cross-process list
  // surface: public callers see plain "Resident" (no number).
  const enriched = await enrichCreators(summaries, {
    rawIdField: "user_id",
    audience: (await resolveCallerUser(req)) ? "member" : "public",
  });
  // Sample content (Phase 7): project id === its canonical processes row
  // id, so one lookup marks every seeded row for the badge.
  const sampleIds = await getSampleProcessIds();
  const withSample =
    sampleIds.size === 0
      ? enriched
      : enriched.map((p) =>
          sampleIds.has((p as { id: string }).id) ? { ...p, is_sample: true } : p,
        );
  res.json(withSample);
});

export const handleGetProject = route(async (req, res) => {
  const id = req.params.id as string;
  // Caller identity comes from the session token, never from ?actor= (which
  // let anyone read another user's sentiment by passing their id). Anonymous
  // callers get the public read model with no per-actor fields.
  const caller = await resolveCallerUser(req);
  const callerId = caller?.id;

  const readModel = await getProjectReadModel(id, callerId);
  if (!readModel) {
    throw new NotFoundError("Project not found");
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
  // Sample content (Phase 7): project id === its canonical processes row id.
  if ((await getSampleProcessIds()).has(id)) {
    (enriched as Record<string, unknown>).is_sample = true;
  }
  res.json(enriched);
});


export const handleSetSentiment = route(async (req, res) => {
  const projectId = req.params.id as string;
  const { sentiment } = req.body ?? {};

  const validSentiments = ["support", "oppose", "neutral"];
  if (!sentiment || !validSentiments.includes(sentiment)) {
    throw new ValidationError(`sentiment must be one of: ${validSentiments.join(", ")}`);
  }

  const user = getAuthUser(res);
  const result = await setProjectSentiment(
    projectId,
    user.id,
    sentiment as SentimentValue | "neutral",
    emitEvent,
  );
  res.json(result);
});


