// processesOf(): a package's view of the processes of its own types (kernel
// step 1, docs/kernel/SURFACE.md, "Processes"). The kernel owns every process;
// a package reads and changes only those of the types it declares, so one
// plugin never reads another's processes through the kernel. Ask for the view
// where it is used, not as the package's module loads (the hub hands a package
// the SDK's values only once the engine has loaded, ADR-017):
//
//   const cloud = await processesOf("civic.wordcloud").get(id);   // undefined unless a word cloud
//
// A method joins here when the first package that needs it moves onto SDK
// version 1.
//
// Acting and reading for a person (Proposals, 0.x): `actOn` runs one action as
// the signed-in person through the kernel's one action path, `page` reads one
// process as its page shows it to the caller, and `view` is the same read
// model for the signed-in person after an action. Another type's id is not
// found through any of them.

import type { Request, Response } from "express";
import type { CreateProcessInput, Process } from "../models/process.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import {
  archiveProcess,
  createProcess,
  getAllProcesses,
  getProcessesWhere,
  getArchivedProcesses,
  getProcess,
  getSampleProcessIds,
  saveProcessState,
} from "./processService.js";
import { processIdByState } from "./processRows.js";
import { actOnProcess, readAsPage, viewFor } from "../controllers/processController.js";
import { getActionDispatcher } from "../processes/serviceSlots.js";
import { getActor, getAuthUser } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { personFallbackName } from "./creatorDisplay.js";
import { reviewMailbox, submitAsCreator } from "../modules/civic.review/index.js";

export interface OwnProcesses {
  /** The types this view covers. */
  readonly types: readonly string[];
  /** The process with this id, when it is one of these types; otherwise undefined. */
  get(id: string): Promise<Process | undefined>;
  /**
   * Its processes, newest first: the public ones (anything not pending review,
   * hidden or archived), or with `archived`, the archived ones. With `limit`,
   * only the newest public ones, at most that many; `where` keeps those whose
   * state holds each value at its key, compared as text (`{ urgent: "true" }`).
   */
  list(options?: { archived?: boolean; limit?: number; where?: Readonly<Record<string, string>> }): Promise<Process[]>;
  /**
   * Make a process of one of these types through the kernel's path (its
   * handler's initializeState, the hub's place, civic.process.created). A type
   * outside the view is refused.
   */
  create(input: CreateProcessInput): Promise<Process>;
  /** Store a process's status and state as they are now (no event; a status change emits its own). */
  saveState(process: Process): Promise<void>;
  /**
   * Archive one (an admin's act, with the reason the admin log and the
   * creator's notice carry). Not found for another type's id.
   */
  archive(id: string, adminId: string, reason: string): Promise<Process>;
  /**
   * Run one action as the signed-in person (a route behind requireResident):
   * who may call it is the type's descriptor; a refusal is a typed error. Not
   * found for another type's id, or one the person may not see.
   */
  actOn(
    res: Response,
    id: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<{ process: Process; result: Record<string, unknown> }>;
  /**
   * The process as its page shows it to whoever is asking: names for members,
   * "Resident N" for visitors, the sample badge, the caller's own part. Not
   * found (with `notFound` as the message) for another type's id.
   */
  page(req: Request, id: string, notFound?: string): Promise<Record<string, unknown>>;
  /** The same read model for the signed-in person, as an action's answer carries it. */
  view(res: Response, id: string): Promise<Record<string, unknown> | null>;
  /** The ids of these types' seeded sample processes (they show the sample badge). */
  sampleIds(): Promise<Set<string>>;
  /**
   * The id of one of these types' processes whose state holds `value` at
   * `key` (a brief's `source_process_id`), or null (kernel step 3).
   */
  idWhere(key: string, value: string): Promise<string | null>;
  /**
   * Run one action as the hub itself (a job, or work after a close commits),
   * through the kernel's one action path. The actor names the part of the
   * package that acted and starts with "system:" (Civic Activity Spec
   * §2.2.1). Not found for another type's id.
   */
  actAsSystem(
    id: string,
    action: string,
    actor: `system:${string}`,
    payload?: Record<string, unknown>,
  ): Promise<{ process: Process; result: Record<string, unknown> }>;
  /**
   * Submit a new process for review as the signed-in person (a route behind
   * requireResident): the kernel's one creation path. An admin's own
   * submission goes live at once; anyone else's waits for an admin.
   * `cocPassed`: the automated Code of Conduct check ran on exactly this text
   * and found nothing (codeOfConduct.check). A type outside the view is
   * refused.
   */
  submit(
    res: Response,
    input: { type: string; title: string; description: string; state: Record<string, unknown> },
    opts: { cocPassed: boolean },
  ): Promise<{ review_id: string; process_id: string; auto_approved: boolean }>;
}

export function processesOf(...types: string[]): OwnProcesses {
  if (types.length === 0) throw new Error("processesOf() needs the package's process types");
  const mine = new Set(types);
  const frozen = Object.freeze([...types]);
  return {
    types: frozen,
    async get(id) {
      const process = await getProcess(id);
      return process && mine.has(process.definition.type) ? process : undefined;
    },
    list(options = {}) {
      if (options.archived) return getArchivedProcesses([...types]);
      if (options.limit !== undefined || options.where) {
        return getProcessesWhere(frozen, { where: options.where, limit: options.limit ?? 1000 });
      }
      return getAllProcesses([...types]);
    },
    create(input) {
      if (!mine.has(input.definition.type)) {
        return Promise.reject(new ForbiddenError(`${input.definition.type} is not one of this package's types`));
      }
      return createProcess(input);
    },
    saveState(process) {
      if (!mine.has(process.definition.type)) {
        return Promise.reject(new ForbiddenError(`${process.definition.type} is not one of this package's types`));
      }
      return saveProcessState(process);
    },
    async archive(id, adminId, reason) {
      const process = await getProcess(id);
      if (!process || !mine.has(process.definition.type)) throw new NotFoundError("Process not found");
      return archiveProcess(id, adminId, reason);
    },
    idWhere: (key, value) => processIdByState(frozen, key, value),
    actOn: (res, id, action, payload = {}) => actOnProcess(res, id, action, payload, frozen),
    page: (req, id, notFound = "Not found") => readAsPage(req, id, frozen, notFound),
    async view(res, id) {
      const process = await getProcess(id);
      return process && mine.has(process.definition.type) ? viewFor(res, id) : null;
    },
    sampleIds: () => getSampleProcessIds(frozen),
    async actAsSystem(id, action, actor, payload = {}) {
      if (!actor.startsWith("system:")) throw new ForbiddenError("A system action's actor starts with \"system:\"");
      const process = await getProcess(id);
      if (!process || !mine.has(process.definition.type)) throw new NotFoundError("Process not found");
      return getActionDispatcher()(id, { type: action, actor, payload });
    },
    async submit(res, input, opts) {
      if (!mine.has(input.type)) throw new ForbiddenError(`${input.type} is not one of this package's types`);
      const user = getAuthUser(res);
      return submitAsCreator(
        {
          process_type: input.type,
          title: input.title,
          description: input.description,
          creator_id: user.id,
          creator_name: user.full_name || user.display_name || personFallbackName(),
          creator_email: reviewMailbox(user.email),
          state: input.state,
        },
        { cocPassed: opts.cocPassed, creatorIsAdmin: await can(getActor(res), "hub.administer") },
      );
    },
  };
}
