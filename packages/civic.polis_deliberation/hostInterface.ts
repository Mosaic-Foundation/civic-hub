// Host-service interface — defines what the Polis plugin needs from its host.
// Representative Space and Civic Hub each provide their own implementation.

export interface EmitEventInput {
  event_type: string;
  actor: string;
  space_slug: string;
  jurisdiction: string;
  data: Record<string, unknown>;
}

export interface InternalOutcomePayload {
  originating_process_id: string;
  originating_process_type: string;
  outcome_summary: string;
  participation_stats: {
    total_participants: number;
    eligible_participants?: number;
    participation_rate?: number;
  };
  result: Record<string, unknown>;
}

export interface OutcomeDeliveryRef {
  id: string;
  delivery_timestamp: string;
}

export interface ResponseRef {
  id: string;
  content: string;
}

export interface PolisHostInterface {
  emitEvent(input: EmitEventInput): void | Promise<void>;
  generateId(prefix?: string): string;
  writeOutcomeDelivery(
    slug: string,
    payload: InternalOutcomePayload,
  ): OutcomeDeliveryRef | Promise<OutcomeDeliveryRef>;
  getResponseById(responseId: string): ResponseRef | null | Promise<ResponseRef | null>;
}
