// Brief controller — public read endpoint for published civic.brief
// records (the universal, permanent public record of a completed process).
//
// Only publication_status = "published" records are returned; pending and
// approved records 404 so they stay invisible until an admin publishes.

import { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import {
  getPublicReadModel,
  type BriefProcessState,
} from "../modules/civic.brief/index.js";

export async function handleGetBrief(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const process = await getProcess(id);
    if (!process || process.definition.type !== "civic.brief") {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    const model = getPublicReadModel(
      process.state as unknown as BriefProcessState,
      { id: process.id, title: process.title, createdAt: process.createdAt },
    );
    if (!model) {
      // Pending or approved-but-not-published — invisible to the public.
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
