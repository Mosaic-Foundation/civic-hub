// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's server entry, in load order, for src/plugins/loader.ts.

// First: the engine the built plugin SDK reads, before any package's module runs (ADR-017).
import "../../src/sdk/install.js";
import type { ConfiguredPackage } from "../../src/plugins/package.js";
import p0 from "../../packages/civic.vote/index.js";
import p1 from "../../packages/civic.proposals/index.js";
import p2 from "../../packages/civic.projects/index.js";
import p3 from "../../packages/civic.vote_results/index.js";
import p4 from "../../packages/civic.brief/index.js";
import p5 from "../../packages/civic.announcement/index.js";
import p6 from "../../packages/civic.meeting_summary/index.js";
import p7 from "../../packages/civic.polis_deliberation/index.js";
import p8 from "../../packages/civic.wordcloud/index.js";
import p9 from "../../packages/civic.event/index.js";

export const CONFIGURED_PACKAGES: readonly ConfiguredPackage[] = [
  { dir: "packages/civic.vote", pkg: p0, files: ["assistantConfig.ts","controller.ts","draftKind.ts","events.ts","handler.ts","index.ts","lifecycle.ts","manifest.ts","methods.ts","models.ts","package.json","results.ts","routes.ts","service.ts","ui.tsx"] },
  { dir: "packages/civic.proposals", pkg: p1, files: ["adminController.ts","adminRoutes.ts","assistantConfig.ts","controller.ts","draftKind.ts","events.ts","handler.ts","index.ts","manifest.ts","models.ts","package.json","routes.ts","service.ts","store.ts","storeImpl.ts","ui.tsx"] },
  { dir: "packages/civic.projects", pkg: p2, files: ["assistantConfig.ts","controller.ts","draftKind.ts","events.ts","handler.ts","index.ts","manifest.ts","models.ts","package.json","routes.ts","service.ts","store.ts","storeImpl.ts","ui.tsx"] },
  { dir: "packages/civic.vote_results", pkg: p3, files: ["adminController.ts","adminRoutes.ts","api.ts","controller.ts","email.ts","events.ts","handler.ts","host.ts","index.ts","lifecycle.ts","manifest.ts","models.ts","package.json","routes.ts","service.ts","ui.tsx"] },
  { dir: "packages/civic.brief", pkg: p4, files: ["adminController.ts","adminRoutes.ts","api.ts","controller.ts","deliberation/prompt.ts","deliberation/summarize.ts","email.ts","events.ts","finalize.ts","handler.ts","host.ts","index.ts","lifecycle.ts","manifest.ts","models.ts","package.json","responses.ts","routes.ts","service.ts","ui.tsx"] },
  { dir: "packages/civic.announcement", pkg: p5, files: ["adminController.ts","adminRoutes.ts","api.ts","controller.ts","events.ts","handler.ts","host.ts","index.ts","lifecycle.ts","manifest.ts","models.ts","package.json","receipt.ts","routes.ts","service.ts","ui.tsx"] },
  { dir: "packages/civic.meeting_summary", pkg: p6, files: ["adminRoutes.ts","api.ts","config.ts","connectors/index.ts","connectors/minutesPage.ts","connectors/wixCms.ts","connectors/youtubeChannel.ts","controller.ts","events.ts","handler.ts","host.ts","identity.ts","index.ts","job.ts","lifecycle.ts","manifest.ts","models.ts","package.json","pipeline.ts","prompts.ts","readiness.ts","routes.ts","service.ts","ui.tsx"] },
  { dir: "packages/civic.polis_deliberation", pkg: p7, files: ["adapter/index.ts","adapter/polisAdapter.ts","adapter/types.ts","api.ts","assistantConfig.ts","boot.ts","controller.ts","draftKind.ts","handler.ts","host.ts","hostInterface.ts","index.ts","manifest.ts","package.json","routes.ts","types.ts","ui.tsx","votes.ts"] },
  { dir: "packages/civic.wordcloud", pkg: p8, files: ["aggregation.ts","controller.ts","handler.ts","index.ts","manifest.ts","models.ts","package.json","routes.ts","service.ts","stopwords.ts","store.ts","storeImpl.ts","ui.tsx"] },
  { dir: "packages/civic.event", pkg: p9, files: ["draftKind.ts","event.ts","handler.ts","ics.ts","index.ts","manifest.ts","migrations/20261027120000_calendar_tables.sql","package.json","routes.ts","store.ts","styles.css","ui.tsx"] },
];
