// Dev-only: render a sample daily digest email to ui/public/digest-sample.html
// so it can be previewed in a browser at mobile width. Not shipped.
//   node --import tsx scripts/renderDigestSample.ts
import { formatDigestHtml } from "../src/modules/civic.digest/service.js";
import { writeFileSync } from "node:fs";
import {
  RENDER_DIGEST_SAMPLE_ITEMS,
  RENDER_DIGEST_SAMPLE_HUB,
} from "../tests/fixtures/samples/renderDigestSample.js";

const items = RENDER_DIGEST_SAMPLE_ITEMS;
const hub = RENDER_DIGEST_SAMPLE_HUB;

writeFileSync("ui/public/digest-sample.html", formatDigestHtml(items, hub, "Your daily update"));
console.log("wrote ui/public/digest-sample.html");
