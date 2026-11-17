import { ValidationError, route, resolveCallerId, enrichCreators, processesOf } from "@civic-social/plugin-sdk";
import {
  listProjects,
  getProjectSummary,
} from "./service.js";

/** The kernel's view of this package's processes (asked for where used: the SDK binds as the hub loads). */
const ownProcesses = () => processesOf("civic.project");

/**
 * POST /projects/:id/complete — mark a project complete (its creator or an
 * admin): process.complete through the one action path. The project closes
 * and the universal seam in executeAction spawns its Civic Brief for review.
 */
export const handleCompleteProject = route(async (req, res) => {
  const id = req.params.id as string;
  await ownProcesses().actOn(res, id, "process.complete");
  res.json({
    ok: true,
    message: "Project marked complete. A brief was created for admin review.",
    view: await ownProcesses().view(res, id),
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
    audience: (await resolveCallerId(req)) ? "member" : "public",
  });
  // Sample content (Phase 7): project id === its canonical processes row
  // id, so one lookup marks every seeded row for the badge.
  const sampleIds = await ownProcesses().sampleIds();
  const withSample =
    sampleIds.size === 0
      ? enriched
      : enriched.map((p) =>
          sampleIds.has((p as { id: string }).id) ? { ...p, is_sample: true } : p,
        );
  res.json(withSample);
});

export const handleGetProject = route(async (req, res) => {
  // The project's read model through the shared read path (its adapter
  // builds the page's shape): bylines, "Resident N" for visitors, sample
  // badge, the caller's own sentiment, and is_owner (never the raw id).
  res.json(await ownProcesses().page(req, req.params.id as string, "Project not found"));
});


/** POST /projects/:id/sentiment — process.sentiment through the one action path. */
export const handleSetSentiment = route(async (req, res) => {
  const { sentiment } = req.body ?? {};
  const id = req.params.id as string;
  const { result } = await ownProcesses().actOn(res, id, "process.sentiment", { sentiment });
  res.json({ ...result, view: await ownProcesses().view(res, id) });
});
