// Word cloud controller — serves cloud data and handles submissions.
//
// The generic /process/:id/action route handles actions (submit, activate,
// snapshot, close) via the ProcessHandler dispatch loop. This controller
// adds read-layer endpoints specific to word clouds:
//   - GET /wordcloud/:id/cloud — aggregated cloud data per prompt
//   - GET /wordcloud/:id      — full read model with cloud data

import { NotFoundError, route, getProcess, resolveCallerId } from "../../src/sdk/index.js";
import {
  buildClouds,
  getSubmissionCount,
  type WordcloudProcessState,
  listVisibleResponses,
  hasVisibleSubmission,
} from "./service.js";


function getState(process: { state: Record<string, unknown> }): WordcloudProcessState {
  return process.state as unknown as WordcloudProcessState;
}

/** Visible submissions for a word cloud process, newest first. */
const listWordcloudResponses = (processId: string, promptId: string | undefined) => listVisibleResponses(processId, promptId);

/**
 * Whether this user has a visible submission on this word cloud process.
 * Best-effort: a failed read answers false.
 */
async function hasWordcloudSubmission(processId: string, authorId: string): Promise<boolean> {
  try {
    return await hasVisibleSubmission(processId, authorId);
  } catch {
    return false;
  }
}

export const handleGetWordcloudCloud = route(async (req, res) => {
  const id = req.params.id as string;
  const process = await getProcess(id);
  if (!process || process.definition.type !== "civic.wordcloud") {
    throw new NotFoundError("Word cloud not found");
  }

  const state = getState(process);
  const clouds = await buildClouds(process.id, state);
  const submissionCount = await getSubmissionCount(process.id);

  res.json({
    id: process.id,
    status: state.status,
    submission_count: submissionCount,
    clouds,
  });
});

export const handleGetWordcloudResponses = route(async (req, res) => {
  const id = req.params.id as string;
  const promptId = req.query.prompt_id as string | undefined;
  const process = await getProcess(id);
  if (!process || process.definition.type !== "civic.wordcloud") {
    throw new NotFoundError("Word cloud not found");
  }

  const responses = await listWordcloudResponses(id, promptId);

  res.json({ responses });
});

export const handleGetWordcloud = route(async (req, res) => {
  const id = req.params.id as string;
  const process = await getProcess(id);
  if (!process || process.definition.type !== "civic.wordcloud") {
    throw new NotFoundError("Word cloud not found");
  }

  const state = getState(process);
  const clouds = await buildClouds(process.id, state);
  const submissionCount = await getSubmissionCount(process.id);

  // Caller identity comes from the session token, never from ?actor= (which
  // let anyone learn whether another resident had contributed by passing
  // their id). Anonymous callers get the public read model with
  // has_submitted false.
  const actor = await resolveCallerId(req);
  const hasSubmitted = actor ? await hasWordcloudSubmission(id, actor) : false;

  res.json({
    id: process.id,
    type: "civic.wordcloud",
    title: process.title,
    description: process.description,
    status: state.status,
    prompts: state.prompts,
    lifecycle_mode: state.lifecycle_mode,
    config: state.config,
    submission_count: submissionCount,
    clouds,
    jurisdiction: process.jurisdiction,
    created_at: process.createdAt,
    has_submitted: hasSubmitted,
    ...(process.isSample ? { is_sample: true } : {}),
  });
});
