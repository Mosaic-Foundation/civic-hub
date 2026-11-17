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
// version 1 (create, saveState and archive follow with Announcements).

import type { Process } from "../models/process.js";
import { getAllProcesses, getArchivedProcesses, getProcess } from "./processService.js";

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
  };
}
