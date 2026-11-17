// links: the related-process links a person proposes on a draft or an edit,
// as a package handles them (kernel step 1, docs/kernel/SURFACE.md, "Process
// links"). The kernel keeps the links between processes
// (src/modules/civic.process_links/, src/services/processLinks.ts); a package
// checks a proposed set before it stores it on a draft.

import { validateLinkSet } from "../modules/civic.process_links/index.js";

export const links = {
  /**
   * A proposed set of links from the process `fromId`, checked: each to a real
   * process with a known relation, none to itself, duplicates collapsed.
   * Throws (a 400) on a bad one.
   */
  validate: validateLinkSet,
};
