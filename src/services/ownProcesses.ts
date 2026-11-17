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
// version 1 (archive follows with Meeting summaries).
//
// Acting and reading for a person (Proposals, 0.x): `actOn` runs one action as
// the signed-in person through the kernel's one action path, `page` reads one
// process as its page shows it to the caller, and `view` is the same read
// model for the signed-in person after an action. Another type's id is not
// found through any of them.

import type { Request, Response } from "express";
import type { CreateProcessInput, Process } from "../models/process.js";
import { ForbiddenError } from "../errors/index.js";
import { createProcess, getAllProcesses, getArchivedProcesses, getProcess, getSampleProcessIds, saveProcessState } from "./processService.js";
import { actOnProcess, readAsPage, viewFor } from "../controllers/processController.js";

export interface OwnProcesses {
  /** The types this view covers. */
  readonly types: readonly string[];
  /** The process with this id, when it is one of these types; otherwise undefined. */
  get(id: string): Promise<Process | undefined>;
  /**
   * Its processes, newest first: the public ones (anything not pending review,
   * hidden or archived), or with `archived`, the archived ones.
   */
  list(options?: { archived?: boolean }): Promise<Process[]>;
  /**
   * Make a process of one of these types through the kernel's path (its
   * handler's initializeState, the hub's place, civic.process.created). A type
   * outside the view is refused.
   */
  create(input: CreateProcessInput): Promise<Process>;
  /** Store a process's status and state as they are now (no event; a status change emits its own). */
  saveState(process: Process): Promise<void>;
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
      return options.archived ? getArchivedProcesses([...types]) : getAllProcesses([...types]);
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
    actOn: (res, id, action, payload = {}) => actOnProcess(res, id, action, payload, frozen),
    page: (req, id, notFound = "Not found") => readAsPage(req, id, frozen, notFound),
    async view(res, id) {
      const process = await getProcess(id);
      return process && mine.has(process.definition.type) ? viewFor(res, id) : null;
    },
    sampleIds: () => getSampleProcessIds(frozen),
  };
}
