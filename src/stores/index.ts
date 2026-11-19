// The modules' stores, bound once (ADR-012, the database convention).
//
// A module (src/modules/civic.*, a plugin) declares the persistence it needs
// in its own store.ts and never imports src/db/. Its implementation lives
// here, one file per module, on forHub() and the hub's tables; installStores()
// binds them. The composition roots call it: src/app.ts, the test setup
// (tests/setup/adapters.ts) and the operator scripts' hub scope
// (scripts/lib/hubScope.ts). Idempotent.
//
// Adding a module's store: its interface and slot in the module's store.ts,
// the implementation here as src/stores/<module>.ts, one bind line below.

import { draftsStore } from "../modules/civic.drafts/store.js";
import { draftsStoreImpl } from "./drafts.js";
import { adminWaitingStore } from "../modules/civic.admin_waiting/store.js";
import { adminWaitingStoreImpl } from "./adminWaiting.js";
import { inputStore } from "../modules/civic.input/store.js";
import { inputStoreImpl } from "./input.js";
import { reviewStore } from "../modules/civic.review/store.js";
import { reviewStoreImpl } from "./review.js";
import { receiptsStore } from "../modules/civic.receipts/store.js";
import { receiptsStoreImpl } from "./receipts.js";
import { authStore } from "../modules/civic.auth/store.js";
import { authStoreImpl } from "./auth.js";
import { aboutStore } from "../modules/civic.about/store.js";
import { aboutStoreImpl } from "./about.js";

export function installStores(): void {
  draftsStore.bind(draftsStoreImpl);
  adminWaitingStore.bind(adminWaitingStoreImpl);
  inputStore.bind(inputStoreImpl);
  reviewStore.bind(reviewStoreImpl);
  receiptsStore.bind(receiptsStoreImpl);
  authStore.bind(authStoreImpl);
  aboutStore.bind(aboutStoreImpl);
}
