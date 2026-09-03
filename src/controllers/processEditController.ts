import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { getProcess } from "../services/processService.js";
import { EditError, getEditPolicy, listEdits, startEdit } from "../services/processEdits.js";

/** GET /process/:id/edit-policy — signed in. Whether THIS viewer may edit. */
export async function handleGetEditPolicy(req: Request, res: Response): Promise<void> {
  const user = getAuthUser(res);
  const process = await getProcess(req.params.id as string);
  if (!process) { res.status(404).json({ error: "Process not found" }); return; }
  res.json(await getEditPolicy(process, { id: user.id, email: user.email }));
}

/** POST /process/:id/edit — creator or admin. Reopens the draft; says where to go. */
export async function handleStartEdit(req: Request, res: Response): Promise<void> {
  const user = getAuthUser(res);
  try {
    const process = await getProcess(req.params.id as string);
    if (!process) { res.status(404).json({ error: "Process not found" }); return; }
    res.json(await startEdit(process, { id: user.id, email: user.email }));
  } catch (err) {
    const status = err instanceof EditError ? err.status : 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not start editing" });
  }
}

/** GET /process/:id/edits — public. The visible history. */
export async function handleListEdits(req: Request, res: Response): Promise<void> {
  try {
    res.json({ edits: await listEdits(req.params.id as string) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
}
