// The News item's one event of its own: result_published, the moment the
// job saves it. Its action_url is the original's permalink, so the feed card
// and the digest open the source site, not the hub's page.

import type { Process } from "@civic-social/plugin-sdk";
import { emitEvent } from "@civic-social/plugin-sdk";
import { newsPayload } from "./state.js";
import type { NewsProcessState } from "./models.js";

export async function emitNewsPublished(process: Process, actor: string): Promise<void> {
  const state = process.state as unknown as NewsProcessState;
  await emitEvent({
    event_type: "civic.process.result_published",
    actor,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: "civic.news",
    action_url_path: state.source.share_url,
    data: { news: newsPayload(state) },
  });
}
