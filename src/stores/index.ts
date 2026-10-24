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

import { wordcloudStore } from "../modules/civic.wordcloud/store.js";
import { wordcloudStoreImpl } from "./wordcloud.js";
import { draftsStore } from "../modules/civic.drafts/store.js";
import { draftsStoreImpl } from "./drafts.js";
import { feedbackStore } from "../modules/civic.feedback/store.js";
import { feedbackStoreImpl } from "./feedback.js";
import { adminDigestStore } from "../modules/civic.admin_digest/store.js";
import { adminDigestStoreImpl } from "./adminDigest.js";
import { proposalsStore } from "../modules/civic.proposals/store.js";
import { proposalsStoreImpl } from "./proposals.js";
import { projectsStore } from "../modules/civic.projects/store.js";
import { projectsStoreImpl } from "./projects.js";
import { inputStore } from "../modules/civic.input/store.js";
import { inputStoreImpl } from "./input.js";
import { reviewStore } from "../modules/civic.review/store.js";
import { reviewStoreImpl } from "./review.js";
import { receiptsStore } from "../modules/civic.receipts/store.js";
import { receiptsStoreImpl } from "./receipts.js";

export function installStores(): void {
  wordcloudStore.bind(wordcloudStoreImpl);
  draftsStore.bind(draftsStoreImpl);
  feedbackStore.bind(feedbackStoreImpl);
  adminDigestStore.bind(adminDigestStoreImpl);
  proposalsStore.bind(proposalsStoreImpl);
  projectsStore.bind(projectsStoreImpl);
  inputStore.bind(inputStoreImpl);
  reviewStore.bind(reviewStoreImpl);
  receiptsStore.bind(receiptsStoreImpl);
}
