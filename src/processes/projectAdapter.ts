// civic.project process handler — thin adapter around the civic.projects module.
//
// A Project is a resident- or org-run initiative with updates, comments, and
// support/oppose sentiment. Like proposals, projects are NOT driven through the
// generic /process/:id/action dispatcher: their lifecycle is owned by the
// civic.projects module and the /projects HTTP surface, which back the
// relational `projects` table. This adapter exists so projects live in the same
// process store and register as a known process type for the unified read layer
// (getAllProcesses / listProcessSummaries), discovery, and the dispatch loop.
//
// The module's rich read models are async (they query the `projects` table)
// while the ProcessHandler read interface is synchronous, so this adapter
// returns only the canonical fields carried on the `processes` row. Full
// project detail continues to be served by the dedicated /projects routes.

import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import { getProject, listProjectUpdates } from "../modules/civic.projects/index.js";
import type { BriefContent } from "../modules/civic.brief/index.js";

const projectAdapter: ProcessHandler = {
  type: "civic.project",
  detailPath: (id: string) => `/project/${id}`,

  // The relational `projects` row holds project state; the canonical
  // `processes` row needs no type-specific state.
  initializeState(): Record<string, unknown> {
    return {};
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new Error(
      `civic.project does not accept generic process actions (received "${action.type}"). ` +
        `Use the /projects endpoints for updates, comments, and sentiment.`,
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      description: process.description,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  // Universal brief: a completed project's outcome is what it accomplished.
  // Seeds structure (community response, number of updates); the admin
  // writes the completion narrative into headline/summary during review.
  async generateBrief(process: Process): Promise<BriefContent | null> {
    const project = await getProject(process.id);
    if (!project) return null;
    const updates = await listProjectUpdates(process.id).catch(() => []);
    const weighedIn = project.support_count + project.oppose_count;

    const sections = [
      {
        heading: "Community response",
        body: `${project.support_count} in support · ${project.oppose_count} opposed.`,
      },
    ];
    if (updates.length > 0) {
      sections.push({
        heading: "Progress",
        body: `${updates.length} update${updates.length === 1 ? "" : "s"} posted over the life of the project.`,
      });
    }

    return {
      title: process.title,
      headline: "Project completed",
      summary: process.description ?? "",
      sections,
      participation_label:
        weighedIn > 0 ? `${weighedIn} resident${weighedIn === 1 ? "" : "s"} weighed in` : null,
      participation_count: weighedIn,
      comments: [],
      admin_notes: "",
    };
  },
};

export default projectAdapter;
