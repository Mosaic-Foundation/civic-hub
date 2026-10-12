import { NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { getEnabledProcess, getProcess } from "../services/processService.js";
import { isProcessTypeEnabled } from "../services/pluginGate.js";
import { getEditPolicy, listEdits, startEdit } from "../services/processEdits.js";

/** GET /process/:id/edit-policy — signed in. Whether THIS viewer may edit. */
export const handleGetEditPolicy = route(async (req, res) => {
  const user = getAuthUser(res);
  const process = await getEnabledProcess(req.params.id as string);
  if (!process) throw new NotFoundError("Process not found");
  res.json(await getEditPolicy(process, { id: user.id, email: user.email }));
});

/** POST /process/:id/edit — creator or admin. Reopens the draft; says where to go. */
export const handleStartEdit = route(async (req, res) => {
  const user = getAuthUser(res);
  const process = await getEnabledProcess(req.params.id as string);
  if (!process) throw new NotFoundError("Process not found");
  res.json(await startEdit(process, { id: user.id, email: user.email }));
});

/** GET /process/:id/edits — public. The visible history. */
export const handleListEdits = route(async (req, res) => {
  const process = await getProcess(req.params.id as string);
  if (process && !isProcessTypeEnabled(process.definition.type)) {
    throw new NotFoundError("Process not found");
  }
  res.json({ edits: await listEdits(req.params.id as string) });
});
