import { NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { resolveCallerUser } from "../middleware/auth.js";
import { buildProcessAnonNumbers } from "../services/processAnonymity.js";
import {
  listProjects,
  getProjectReadModel,
  getProjectSummary,
} from "../modules/civic.projects/index.js";
import { enrichCreator, enrichCreators } from "../services/creatorDisplay.js";
import { getSampleProcessIds } from "../services/processService.js";
import { actOnProcess } from "./processController.js";

/**
 * POST /projects/:id/complete — mark a project complete (its creator or an
 * admin): process.complete through the one action path. The project closes
 * and the universal seam in executeAction spawns its Civic Brief for review.
 */
export const handleCompleteProject = route(async (req, res) => {
  await actOnProcess(res, req.params.id as string, "process.complete", {}, "civic.project");
  res.json({
    ok: true,
    message: "Project marked complete. A brief was created for admin review.",
  });
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


/** POST /projects/:id/sentiment — process.sentiment through the one action path. */
export const handleSetSentiment = route(async (req, res) => {
  const { sentiment } = req.body ?? {};
  const { result } = await actOnProcess(res, req.params.id as string, "process.sentiment", { sentiment }, "civic.project");
  res.json(result);
});
