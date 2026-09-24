import { emitEvent } from "../../events/eventEmitter.js";
import { DEFAULT_JURISDICTION } from "../../config/hub.js";


export async function emitReviewEvent(input: {
  event_type: string;
  actor: string;
  process_id: string;
  review_id: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await emitEvent({
    event_type: input.event_type,
    actor: input.actor,
    process_id: input.process_id,
    jurisdiction: DEFAULT_JURISDICTION,
    data: {
      ...input.data,
      review_id: input.review_id,
    },
    visibility: "restricted",
  });
}
