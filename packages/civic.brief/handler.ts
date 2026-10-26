// civic.brief process handler — thin adapter around the civic.brief module.
//
// Registers `civic.brief` as a process type so briefs are stored in the
// same process store as votes/proposals/etc. Like civic.vote_results,
// briefs are not driven through the generic POST /process/:id/action
// dispatcher — their admin surface is /admin/briefs/*. This adapter exists
// to initialize state and produce read models.

import {
  ValidationError,
  type Process,
  type ProcessAction,
  type ProcessHandler,
  str,
  num,
  type FeedProcessMeta,
} from "../../src/sdk/index.js";
import {
  createBriefState,
  getPublicReadModel,
  getAdminSummary,
  type BriefContent,
  type BriefProcessState,
  type CreateBriefInput,
} from "./api.js";
import { BRIEF_MANIFEST } from "./manifest.js";

function getState(process: Process): BriefProcessState {
  return process.state as unknown as BriefProcessState;
}

const briefProcess: ProcessHandler = {
  type: "civic.brief",
  descriptor: BRIEF_MANIFEST.descriptor,
  requiredSchema: [...BRIEF_MANIFEST.requiredSchema],
  detailPath: BRIEF_MANIFEST.detailPath,
  // Social previews carry the approved headline, not the (empty) row
  // description. Unpublished records are not shareable at all.
  describeShare: (process) => {
    const state = process.state as {
      publication_status?: unknown;
      content?: { headline?: unknown; image_url?: unknown };
    };
    if (state.publication_status !== "published") return null;
    const headline =
      typeof state.content?.headline === "string" ? state.content.headline.trim() : "";
    return headline ? { description: headline } : {};
  },

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Briefs are always created programmatically by the close flow
    // (spawnBriefFromClosedProcess), which passes a CreateBriefInput shape.
    const required = ["source_process_id", "source_process_type", "content"] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new ValidationError(
          "Briefs are created automatically when a process closes; they can't be created directly.",
          "cannot_create_directly",
        );
      }
    }
    const briefInput: CreateBriefInput = {
      source_process_id: input.source_process_id as string,
      source_process_type: input.source_process_type as string,
      content: input.content as BriefContent,
    };
    return createBriefState(briefInput) as unknown as Record<string, unknown>;
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new ValidationError(
      "Briefs don't take actions here. Review them from the admin briefs page.",
        "action_not_supported",
    );
  },

  // GET /process/:id/state is public: the published record only (null until
  // then, so it is not found). It served the admin read model until
  // 2026-10-13: unpublished text, and for briefs the recipients' emails.
  // Admin pages read the admin model through their own routes.
  getReadModel(process: Process): Record<string, unknown> | null {
    return getPublicReadModel(getState(process), {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
    });
  },

  getSummary(process: Process): Record<string, unknown> {
    return getAdminSummary(getState(process), {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
    });
  },
  // The feed card's fields. The published brief (public read model): its
  // current headline, and when a regenerated version replaced it.
  feedMeta(model: Record<string, unknown>): FeedProcessMeta {
    return {
      title: str(model.title),
      description: str(model.headline),
      lastEditedAt: str(model.revised_at) ?? null,
      editCount: str(model.revised_at) ? 1 : 0,
    };
  },
};

export default briefProcess;
