// civic.news process handler. News items are made by the news sync job
// (./job.ts) through the kernel's create path; nothing reaches them through
// the generic /process/:id/action dispatcher.

import {
  ValidationError,
  type Process,
  type ProcessHandler,
  str,
  type FeedProcessMeta,
} from "@civic-social/plugin-sdk";
import { createNewsState, newsReadModel } from "./state.js";
import type { NewsProcessState } from "./models.js";
import { NEWS_MANIFEST } from "./manifest.js";

const newsProcess: ProcessHandler = {
  type: "civic.news",
  descriptor: NEWS_MANIFEST.descriptor,
  requiredSchema: [...NEWS_MANIFEST.requiredSchema],
  detailPath: NEWS_MANIFEST.detailPath,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    return createNewsState(input) as unknown as Record<string, unknown>;
  },

  handleAction(): Promise<Record<string, unknown>> {
    return Promise.reject(
      new ValidationError("News items don't take actions. They are copied in by News Sync.", "action_not_supported"),
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    return newsReadModel(process.state as unknown as NewsProcessState, { id: process.id, createdAt: process.createdAt });
  },

  getSummary(process: Process): Record<string, unknown> {
    const model = newsReadModel(process.state as unknown as NewsProcessState, { id: process.id, createdAt: process.createdAt });
    return { id: model.id, type: model.type, title: model.title, from: model.from, created_at: model.created_at };
  },

  // The feed card's fields, from the public read model.
  feedMeta(model: Record<string, unknown>): FeedProcessMeta {
    return { title: str(model.title), description: str(model.body) };
  },
};

export default newsProcess;
