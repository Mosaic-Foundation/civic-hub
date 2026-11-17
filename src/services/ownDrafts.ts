// draftsOf(): a package's view of the drafts of its own drafting kind (kernel
// step 1, docs/kernel/SURFACE.md, "Drafting"). The kernel keeps every draft
// (src/modules/civic.drafts/, one store for all kinds); a package names its
// kind once and gets that kind's drafts, never another's:
//
//   const drafts = draftsOf(proposalDraftKind);
//   await drafts.setStatus(id, "drafting");
//
// `assistantStore()` is what a type's drafting-assistant config hands the
// assistant (AssistantTypeConfig.draftStore): the same four calls every type
// wired by hand, with a type's own reading or writing passed as overrides.
// Like processesOf(), ask for it where it is used, not as the module loads.

import type { AssistantDraftStore } from "../processes/contracts/draftingHelp.js";
import {
  appendConversation,
  applyGeneratedDraft,
  createDraft,
  getDraft,
  saveReviewResult,
  setDraftStatus,
  updateDraft,
  type Draft,
  type DraftPatch,
  type DraftSpec,
  type DraftStatus,
} from "../modules/civic.drafts/index.js";

export interface OwnDrafts<E extends object = Record<string, unknown>> {
  /** The draft with this id, or undefined. */
  get(id: string): Promise<Draft<E> | undefined>;
  /** Start a draft for this person, with the kind's create input. */
  create(userId: string, input?: Record<string, unknown>): Promise<Draft<E>>;
  /** Apply a patch: the base text fields, links, and the kind's writable fields. */
  update(id: string, patch: DraftPatch): Promise<Draft<E>>;
  /** Move the draft to drafting, submitted or abandoned (a refused review reopens it). */
  setStatus(id: string, status: DraftStatus): Promise<void>;
  /**
   * The store the drafting assistant reads and writes this kind's drafts
   * through. A type that shows the assistant its draft differently (a vote's
   * options as lines) passes its own `get` or `applyGeneratedDraft`.
   */
  assistantStore(overrides?: Partial<AssistantDraftStore>): AssistantDraftStore;
}

/** A drafting kind (its `spec` is what the store needs), or its spec alone. */
type KindOrSpec = { spec: DraftSpec } | DraftSpec;

export function draftsOf<E extends object = Record<string, unknown>>(kind: KindOrSpec): OwnDrafts<E> {
  const spec: DraftSpec = "spec" in kind ? kind.spec : kind;
  return {
    get: (id) => getDraft<E>(spec, id),
    create: (userId, input) => createDraft<E>(spec, userId, input),
    update: (id, patch) => updateDraft<E>(spec, id, patch),
    setStatus: (id, status) => setDraftStatus(spec, id, status),
    assistantStore: (overrides = {}) => ({
      async get(id) {
        const draft = await getDraft(spec, id);
        return draft ? ({ ...draft } as never) : undefined;
      },
      appendConversation: (id, userMessage, assistantMessage) => appendConversation(spec, id, userMessage, assistantMessage),
      saveReviewResult: (id, suggestions, checkedHash) => saveReviewResult(spec, id, suggestions, checkedHash),
      applyGeneratedDraft: async (id, draft) => {
        await applyGeneratedDraft(spec, id, { ...draft });
      },
      ...overrides,
    }),
  };
}
