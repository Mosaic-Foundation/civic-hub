// Dev-only: render a sample daily digest email to ui/public/digest-sample.html
// so it can be previewed in a browser at mobile width. Not shipped.
//   node --import tsx scripts/renderDigestSample.ts
import { formatDigestHtml } from "../src/modules/civic.digest/service.js";
import type { DigestItem, DigestHubContext } from "../src/modules/civic.digest/models.js";
import { writeFileSync } from "node:fs";

const items: DigestItem[] = [
  { kind: "announcement", title: "County offices will be Closed July 3rd in Observance of the 4th of July", pill_label: "Floyd County Gov", summary: "", action_url: "#", timestamp: "2026-07-01T10:00:00Z" },
  { kind: "proposal", title: "A community tool library for Floyd", pill_label: "New proposal", summary: "A new idea is open for support and discussion.", action_url: "#", timestamp: "2026-07-01T09:00:00Z" },
  { kind: "project-created", title: "Build a Community Skate Park in Floyd County", pill_label: "New project", summary: "A new community project was posted.", action_url: "#", timestamp: "2026-07-01T08:00:00Z" },
  { kind: "conversation", title: "What recreational equipment do you want to see built in Floyd?", pill_label: "New conversation", summary: "Join the conversation and share your view.", action_url: "#", timestamp: "2026-07-01T07:00:00Z" },
];

const hub: DigestHubContext = {
  hub_name: "Floyd Civic Hub",
  ui_base_url: "https://floyd.civic.social",
  postal_address: "Floyd, VA",
  unsubscribe_url: "#",
  manage_subscriptions_url: "#",
};

writeFileSync("ui/public/digest-sample.html", formatDigestHtml(items, hub, "Your daily update"));
console.log("wrote ui/public/digest-sample.html");
