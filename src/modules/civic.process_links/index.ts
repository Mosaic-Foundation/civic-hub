// civic.process_links — public surface.

export type {
  LinkDirection,
  LinkPeer,
  LinkProposal,
  ProcessLinkEdge,
  RelationType,
  RenderedLink,
  RenderedLinks,
} from "./models.js";

export { RELATIONS, RELATION_LABELS } from "./models.js";

export {
  canEditLinks,
  canRemoveLink,
  edgeBelongsToProcess,
  isRemovableLink,
  LinkValidationError,
  MAX_LINKS_PER_PROCESS,
  isRelationType,
  renderLinks,
  suggestionSeed,
  validateLink,
  validateLinkSet,
} from "./service.js";
