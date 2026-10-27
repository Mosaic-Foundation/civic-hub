// What the counts are over, from the types' declarations alone (ADR-016).
// Pure, and names no process type: every type is counted by what its
// manifest's `participation` says, the host's own events (comments,
// submissions for review) for every type alike.

import { HOST_PARTICIPATION, MEASURES, type MeasureId, type ParticipationDeclaration } from "../../src/shared/participation.js";
import type { ActorCountPlan, EventPair, ProcessTypeSummary } from "../../src/sdk/index.js";

/** The role each (process type, event type) plays in the counts. */
export type Role = "participation" | "creation" | "closing" | "outcome";

const listOf = (d: ParticipationDeclaration): readonly string[] => (Array.isArray(d.participation) ? d.participation : []);

/** Every role an event of `type` plays: its own declaration's, and the host's participation. */
export function rolesOf(types: readonly ProcessTypeSummary[]): (processType: string, eventType: string) => Role[] {
  const byType = new Map(types.map((t) => [t.type, t]));
  return (processType, eventType) => {
    const out: Role[] = [];
    const d = byType.get(processType)?.participation;
    if (HOST_PARTICIPATION.includes(eventType) || (d && listOf(d).includes(eventType))) out.push("participation");
    if (d?.creation.includes(eventType)) out.push("creation");
    if (d?.closing.includes(eventType)) out.push("closing");
    if (d?.outcome.includes(eventType)) out.push("outcome");
    return out;
  };
}

/** The pairs that make a resident active on one type: its participation, and its creation when residents create it. */
function actsOf(t: ProcessTypeSummary): EventPair[] {
  const d = t.participation;
  if (!d) return [];
  return [...listOf(d), ...(t.residentCreated ? d.creation : [])].map((e) => ({ t: t.type, e }));
}

/** The types feeding a measure through a role. */
export function feeders(types: readonly ProcessTypeSummary[], id: MeasureId, role: "participation" | "outcome"): ProcessTypeSummary[] {
  return types.filter((t) => t.participation?.measures?.[id] === role);
}

export function buildPlan(types: readonly ProcessTypeSummary[]): ActorCountPlan {
  const acts: EventPair[] = [...types.flatMap(actsOf), ...HOST_PARTICIPATION.map((e) => ({ t: "*", e }))];
  const measures: Record<string, EventPair[]> = {};
  const sources: ActorCountPlan["sources"][number][] = [];
  for (const m of MEASURES) {
    const viaParticipation = feeders(types, m.id, "participation").filter((t) => Array.isArray(t.participation?.participation));
    if (viaParticipation.length > 0) {
      measures[m.id] = viaParticipation.flatMap((t) => [
        ...actsOf(t),
        ...HOST_PARTICIPATION.map((e) => ({ t: t.type, e })),
      ]);
    }
    for (const t of feeders(types, m.id, "outcome")) {
      const f = t.participation?.sourceField;
      if (f) for (const e of t.participation!.outcome) sources.push({ id: m.id, t: t.type, e, f });
    }
  }
  const elsewhere = types.filter((t) => t.participation?.participation === "elsewhere").map((t) => t.type);
  const totals = types.flatMap((t) =>
    (t.participation?.sourceTotals ?? []).map((x) => ({ t: t.type, e: x.event, f: t.participation!.sourceField!, n: x.field, of: elsewhere })),
  );
  return { acts, measures, sources, totals };
}

/** The event types behind each role of each type, for a measure's provenance. */
export function provenance(
  types: readonly ProcessTypeSummary[],
  id: MeasureId,
): { participation: Array<{ type: string; label: string; events: string[] }>; outcome: Array<{ type: string; label: string; events: string[] }> } {
  const participation = feeders(types, id, "participation").map((t) => ({
    type: t.type,
    label: t.plural,
    events:
      t.participation?.participation === "elsewhere"
        ? (types.flatMap((s) => (s.participation?.sourceTotals ?? []).map((x) => `${x.event} (${x.field}, recorded by ${s.plural.toLowerCase()})`)))
        : [...actsOf(t).map((p) => p.e), ...HOST_PARTICIPATION],
  }));
  const outcome = feeders(types, id, "outcome").map((t) => ({ type: t.type, label: t.plural, events: [...(t.participation?.outcome ?? [])] }));
  return { participation, outcome };
}
