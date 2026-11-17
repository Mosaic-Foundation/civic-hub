// inputs: what people wrote on a process (comments, a project's updates), as
// a package reads it (kernel step 1, docs/kernel/SURFACE.md, "Community
// input"). The kernel keeps every input (src/modules/civic.input/) and its
// moderation; a package reads the ones on its processes.

import {
  countVisibleOutsidePhase,
  getInputsByProcess,
  listVisibleInPhase,
  type CommunityInput,
} from "../modules/civic.input/index.js";

export const inputs = {
  /** Every input on the process, oldest first. */
  forProcess: (processId: string): Promise<CommunityInput[]> => getInputsByProcess(processId),
  /** The visible inputs in one phase of the process ("update", "comment", …). */
  visibleInPhase: listVisibleInPhase,
  /** How many visible inputs on the process are in some other phase. */
  countVisibleOutsidePhase,
};
