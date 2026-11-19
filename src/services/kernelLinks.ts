// links: the related-process links a person proposes on a draft or an edit,
// as a package handles them (kernel step 1, docs/kernel/SURFACE.md, "Process
// links"). The kernel keeps the links between processes
// (src/modules/civic.process_links/, src/services/processLinks.ts); a package
// checks a proposed set before it stores it on a draft.

import { validateLinkSet } from "../modules/civic.process_links/index.js";
import { processWireIris } from "./processLinks.js";
import { countLinksTouching } from "./processLinkCounts.js";

export const links = {
  /**
   * A proposed set of links from the process `fromId`, checked: each to a real
   * process with a known relation, none to itself, duplicates collapsed.
   * Throws (a 400) on a bad one.
   */
  validate: validateLinkSet,
  /**
   * How many links touch each of these processes, in either direction (since
   * Briefs: an outcome counts its source's). A failed read throws.
   */
  countTouching: countLinksTouching,
  /**
   * Each process's IRI, as its activities carry it (`context.id`, ADR-008), by
   * id. Since Briefs: a result names the process it is about on the wire.
   */
  wireIris: processWireIris,
};
