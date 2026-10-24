// A module's store, bound by the host (ADR-012, the database convention).
//
// A module (src/modules/civic.*, a plugin) never imports src/db/. It declares
// the persistence it needs as an interface in its own store.ts, with a slot:
//
//   export interface ProposalsStore { … }
//   export const proposalsStore = storeSlot<ProposalsStore>("civic.proposals");
//
// and calls `proposalsStore.get().…`. The implementation is the host's, in
// src/stores/<module>.ts (forHub(), readAll(), the hub's tables), bound once
// by installStores() (src/stores/index.ts), which the composition roots call:
// src/app.ts, the test setup, and the operator scripts' hub scope. A test may
// bind its own in-memory store instead.

export interface StoreSlot<T> {
  /** Bind the implementation (the host at startup, or a test). */
  bind(store: T): void;
  /** The bound implementation; throws, naming the slot, when nothing is bound. */
  get(): T;
  /** Whether something is bound. */
  bound(): boolean;
}

export function storeSlot<T>(name: string): StoreSlot<T> {
  let current: T | null = null;
  return {
    bind(store) {
      current = store;
    },
    get() {
      if (current === null) {
        throw new Error(`The ${name} store is not bound: call installStores() (src/stores/index.ts) at startup.`);
      }
      return current;
    },
    bound: () => current !== null,
  };
}
