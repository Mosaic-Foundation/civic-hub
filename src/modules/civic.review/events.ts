import { buildEvent, emitEvent } from "../../events/eventEmitter.js";
import type { CivicEvent } from "../../models/event.js";
import { defaultJurisdiction } from "../../config/hub.js";


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
    jurisdiction: defaultJurisdiction(),
    data: {
      ...input.data,
      review_id: input.review_id,
    },
    visibility: "restricted",
  });
}

/**
 * The review event emitReviewEvent would store, built but not stored: for a
 * write that stores it in the same transaction (submit_for_review).
 */
export function buildReviewEvent(input: {
  event_type: string;
  actor: string;
  process_id: string;
  review_id: string;
  data: Record<string, unknown>;
}): CivicEvent {
  return buildEvent({
    event_type: input.event_type,
    actor: input.actor,
    process_id: input.process_id,
    jurisdiction: defaultJurisdiction(),
    data: {
      ...input.data,
      review_id: input.review_id,
    },
    visibility: "restricted",
  });
}
