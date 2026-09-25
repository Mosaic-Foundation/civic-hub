// Dry-run: build the admin digest payload + render the email, but
// don't dispatch. Used to verify Slice 16 wiring against dev
// Supabase without needing CRON_SECRET locally.
//
// Run with:  node --env-file=.env --import tsx scripts/dryRunAdminDigest.ts --hub <slug>
//
// Pass --stub to render a non-empty payload regardless of the live DB
// state (useful to verify the email layout when dev queues are empty).

import {
  buildAdminDigest,
  renderAdminDigestEmail,
} from "../src/modules/civic.admin_digest/index.js";
import { buildStubAdminDigestPayload } from "../tests/fixtures/samples/dryRunAdminDigest.js";
import type { Hub } from "../src/models/hub.js";
import { withScriptHub } from "./lib/hubScope.js";

async function main(_hub: Hub) {
  const useStub = process.argv.includes("--stub");
  const payload = useStub ? buildStubAdminDigestPayload(new Date().toISOString()) : await buildAdminDigest();
  console.log("--- payload ---");
  console.log(JSON.stringify(payload, null, 2));
  console.log("");
  if (payload.empty) {
    console.log("(empty — would skip send in production)");
    return;
  }
  const { subject, text } = renderAdminDigestEmail(payload);
  console.log("--- subject ---");
  console.log(subject);
  console.log("");
  console.log("--- text body ---");
  console.log(text);
}

withScriptHub(main).catch((err) => {
  console.error("dry-run failed:", err);
  process.exit(1);
});
