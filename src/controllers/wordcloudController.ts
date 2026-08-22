// Word cloud controller — serves cloud data and handles submissions.
//
// The generic /process/:id/action route handles actions (submit, activate,
// snapshot, close) via the ProcessHandler dispatch loop. This controller
// adds read-layer endpoints specific to word clouds:
//   - GET /wordcloud/:id/cloud — aggregated cloud data per prompt
//   - GET /wordcloud/:id      — full read model with cloud data

import { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import { getDb } from "../db/client.js";
import { resolveCallerId } from "../middleware/auth.js";
import {
  buildClouds,
  getSubmissionCount,
  type WordcloudProcessState,
} from "../modules/civic.wordcloud/index.js";

function getState(process: { state: Record<string, unknown> }): WordcloudProcessState {
  return process.state as unknown as WordcloudProcessState;
}

export async function handleGetWordcloudCloud(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const process = await getProcess(id);
    if (!process || process.definition.type !== "civic.wordcloud") {
      res.status(404).json({ error: "Word cloud not found" });
      return;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetWordcloudResponses(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const promptId = req.query.prompt_id as string | undefined;
    const process = await getProcess(id);
    if (!process || process.definition.type !== "civic.wordcloud") {
      res.status(404).json({ error: "Word cloud not found" });
      return;
    }

    let query = getDb()
      .from("wordcloud_submissions")
      .select("id, body, submitted_at, prompt_id")
      .eq("process_id", id)
      .is("hidden_at", null)
      .order("submitted_at", { ascending: false });

    if (promptId) {
      query = query.eq("prompt_id", promptId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    res.json({ responses: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetWordcloud(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const process = await getProcess(id);
    if (!process || process.definition.type !== "civic.wordcloud") {
      res.status(404).json({ error: "Word cloud not found" });
      return;
    }

    const state = getState(process);
    const clouds = await buildClouds(process.id, state);
    const submissionCount = await getSubmissionCount(process.id);

    // Caller identity comes from the session token, never from ?actor= (which
    // let anyone learn whether another resident had contributed by passing
    // their id). Anonymous callers get the public read model with
    // has_submitted false.
    const actor = await resolveCallerId(req);
    let hasSubmitted = false;
    if (actor) {
      const { count, error: countErr } = await getDb()
        .from("wordcloud_submissions")
        .select("id", { count: "exact", head: true })
        .eq("process_id", id)
        .eq("author_id", actor)
        .is("hidden_at", null);
      if (!countErr && (count ?? 0) > 0) hasSubmitted = true;
    }

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
      created_by: process.createdBy,
      has_submitted: hasSubmitted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
