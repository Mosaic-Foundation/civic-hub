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

import type { CreateProcessInput, Process } from "../models/process.js";
import { ForbiddenError } from "../errors/index.js";
import { createProcess, getAllProcesses, getArchivedProcesses, getProcess, saveProcessState } from "./processService.js";

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
  };
}
