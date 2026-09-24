// FIXTURE DATA — sample digest items and hub context used by
// scripts/renderDigestSample.ts to render a preview digest email.

import type { DigestItem, DigestHubContext } from "../../../src/modules/civic.digest/models.js";

export const RENDER_DIGEST_SAMPLE_ITEMS: DigestItem[] = [
  { kind: "announcement", color: "announcement", title: "County offices will be Closed July 3rd in Observance of the 4th of July", pill_label: "Floyd County Gov", summary: "", action_url: "#", timestamp: "2026-07-01T10:00:00Z" },
  { kind: "proposal", color: "proposal", title: "A community tool library for Floyd", pill_label: "New proposal", summary: "A new idea is open for support and discussion.", action_url: "#", timestamp: "2026-07-01T09:00:00Z" },
  { kind: "project-created", color: "project", title: "Build a Community Skate Park in Floyd County", pill_label: "New project", summary: "A new community project was posted.", action_url: "#", timestamp: "2026-07-01T08:00:00Z" },
  { kind: "conversation", color: "conversation", title: "What recreational equipment do you want to see built in Floyd?", pill_label: "New conversation", summary: "Join the conversation and share your view.", action_url: "#", timestamp: "2026-07-01T07:00:00Z" },
];

export const RENDER_DIGEST_SAMPLE_HUB: DigestHubContext = {
  hub_name: "Floyd Civic Hub",
  ui_base_url: "https://floyd.civic.social",
  postal_address: "Floyd, VA",
  unsubscribe_url: "#",
  manage_subscriptions_url: "#",
};
