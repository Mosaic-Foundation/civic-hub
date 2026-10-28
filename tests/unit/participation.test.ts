// What counts as participation (ADR-016): the declaration's check, and every
// shipped type declaring one.

import { describe, expect, it } from "vitest";
import { participationProblem, MEASURES, MEASURE_IDS, type ParticipationDeclaration } from "../../src/shared/participation.js";
import { PROCESS_MANIFESTS } from "../../src/shared/processManifests.js";
import { HOST_EVENT_TYPES } from "../../src/processes/descriptor.js";

const facts = { emits: ["x.thing.done", "x.thing.ended"], hostTypes: ["civic.process.created"] };
const ok = { participation: ["x.thing.done"], creation: ["civic.process.created"], closing: ["x.thing.ended"], outcome: [] };

describe("participationProblem", () => {
  it("accepts a declaration naming events the type emits", () => {
    expect(participationProblem(ok, facts)).toBeNull();
    expect(participationProblem({ ...ok, participation: "none" }, facts)).toBeNull();
    expect(participationProblem({ ...ok, participation: "elsewhere" }, facts)).toBeNull();
  });

  it("refuses a missing declaration, an empty participation list, and events it does not emit", () => {
    expect(participationProblem(undefined, facts)).toMatch(/must be declared/);
    expect(participationProblem({ ...ok, participation: [] }, facts)).toMatch(/at least one event type/);
    expect(participationProblem({ ...ok, creation: ["x.other.made"] }, facts)).toMatch(/not an event type it emits/);
    expect(participationProblem({ ...ok, closing: "x.thing.ended" }, facts)).toMatch(/must be a list/);
  });

  it("accepts a withdrawal it emits, counted in no other role (E17)", () => {
    const f = { ...facts, emits: [...facts.emits, "x.thing.undone"] };
    expect(participationProblem({ ...ok, withdrawal: ["x.thing.undone"] }, f)).toBeNull();
    expect(participationProblem({ ...ok, withdrawal: ["x.thing.done"] }, f)).toMatch(/also counted in another role/);
    expect(participationProblem({ ...ok, withdrawal: ["x.other.undone"] }, f)).toMatch(/not an event type it emits/);
  });

  it("refuses an unknown measure, and a measure fed by a role it lacks", () => {
    expect(participationProblem({ ...ok, measures: { bowling_alone: "participation" } }, facts)).toMatch(/not a measure/);
    expect(participationProblem({ ...ok, measures: { met_in_public: "outcome" } }, facts)).toMatch(/declares none/);
    expect(participationProblem({ ...ok, participation: "none", measures: { met_in_public: "participation" } }, facts)).toMatch(
      /declares none/,
    );
  });

  it("refuses source totals without a source field", () => {
    expect(participationProblem({ ...ok, sourceTotals: [{ event: "x.thing.done", field: "n" }] }, facts)).toMatch(/sourceField/);
    expect(participationProblem({ ...ok, sourceField: "source_process_id", sourceTotals: [{ event: "x.thing.done", field: "n" }] }, facts)).toBeNull();
  });
});

describe("the shipped types", () => {
  it("each declares its participation, and the declaration is well formed", () => {
    for (const m of PROCESS_MANIFESTS) {
      expect(m.participation, m.descriptor.type).toBeTruthy();
      expect(participationProblem(m.participation, { emits: m.descriptor.emits, hostTypes: HOST_EVENT_TYPES }), m.descriptor.type).toBeNull();
    }
  });

  it("every funder measure is fed by at least one type, and has its derivation sentence", () => {
    expect(MEASURES.map((m) => m.id)).toEqual([...MEASURE_IDS]);
    for (const measure of MEASURES) {
      const feeders = PROCESS_MANIFESTS.filter((m) => (m.participation as ParticipationDeclaration | undefined)?.measures?.[measure.id]);
      expect(feeders.length, measure.id).toBeGreaterThan(0);
      expect(measure.derivation.length).toBeGreaterThan(40);
    }
  });
});
