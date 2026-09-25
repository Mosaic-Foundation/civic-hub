// Dry-run: render the user-facing digest HTML for a stub set of items
// covering ALL four digest kinds (announcement, vote open, vote
// results, meeting summary), so we can inspect the markup without
// sending an email.
//
// Run with: node --env-file=.env --import tsx scripts/dryRunUserDigest.ts --hub <slug>

import { assembleDigestForUser } from "../src/modules/civic.digest/index.js";
import {
  DRY_RUN_USER_DIGEST_HUB,
  DRY_RUN_USER_DIGEST_SINCE,
  DRY_RUN_USER_DIGEST_EVENTS,
  DRY_RUN_USER_DIGEST_PROCESS_TITLES,
} from "../tests/fixtures/samples/dryRunUserDigest.js";
import { writeFileSync } from "node:fs";
import type { Hub } from "../src/models/hub.js";
import { withScriptHub } from "./lib/hubScope.js";

async function main(_hub: Hub) {
  const hub = DRY_RUN_USER_DIGEST_HUB;
  const since = DRY_RUN_USER_DIGEST_SINCE;
  const stubEvents = DRY_RUN_USER_DIGEST_EVENTS;

  const result = assembleDigestForUser({
    user: {
      id: "user_test",
      email: "test@example.com",
      created_at: "2026-04-01T00:00:00Z",
      last_digest_sent_at: since,
    },
    events: stubEvents,
    hub,
    since,
    process_titles: DRY_RUN_USER_DIGEST_PROCESS_TITLES,
    process_thumbnails: {},
  });

  if (!result) {
    console.log("(empty digest — no items)");
    return;
  }

  console.log("--- subject ---");
  console.log(result.subject);
  console.log("");
  console.log("--- summary check: anchors per row ---");
  const html = result.html;
  const rowMatches = html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];
  console.log(`Total rows: ${rowMatches.length}`);
  rowMatches.forEach((row, i) => {
    const wrapAnchor = row.match(/<a href="([^"]+)" style="display:block;text-decoration:none;color:inherit;"/);
    const innerAnchorCount = (row.match(/<a /g) ?? []).length;
    const hasChevron = row.includes("&rsaquo;");
    const pillMatch = row.match(/border-radius:9999px;">([^<]+)<\/span>/);
    console.log(
      `  Row ${i + 1}: wrap=${wrapAnchor ? "yes" : "NO"}, anchors=${innerAnchorCount}, chevron=${hasChevron ? "yes" : "NO"}, pill="${pillMatch?.[1] ?? "?"}"`,
    );
  });

  // Dump full HTML to a file so we can open it in a browser for visual inspection.
  writeFileSync("/tmp/digest-preview.html", html);
  console.log("");
  console.log("--- full HTML written to /tmp/digest-preview.html ---");
}

withScriptHub(main);
