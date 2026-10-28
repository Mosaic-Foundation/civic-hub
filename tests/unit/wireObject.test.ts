/**
 * A type's wire object (src/shared/activityRecipe.ts WireObjectRecipe): its
 * processes on the wire as a standard vocabulary object (an AS2 Event) with
 * properties lifted from the always-public `process` block, only when the
 * payload has the object's substance. No shipped type before plugin Events
 * declares one, so every existing document keeps its bytes.
 */
import { describe, it, expect } from "vitest";
import { applyWireObject } from "../../src/events/activitySerializer.js";
import { wireObjectProblem } from "../../src/processes/manifest.js";
import type { WireObjectRecipe } from "../../src/shared/activityRecipe.js";

const RECIPE: WireObjectRecipe = {
  type: "Event",
  properties: {
    startTime: "process.event.start_time",
    endTime: "process.event.end_time",
    location: "process.event.location",
  },
  requires: ["startTime"],
};

describe("applyWireObject", () => {
  it("types the object and lifts what the payload has, in declared order", () => {
    const object: Record<string, unknown> = { type: "civic:Process", id: "https://hub.test/process/p_1", name: "Cleanup" };
    applyWireObject(
      object,
      { process: { type: "civic.event", event: { location: { type: "Place", name: "Hall" }, start_time: "2026-11-01T17:00:00Z" } } },
      RECIPE,
    );
    expect(object).toEqual({
      type: "Event",
      id: "https://hub.test/process/p_1",
      name: "Cleanup",
      startTime: "2026-11-01T17:00:00Z",
      location: { type: "Place", name: "Hall" },
    });
    expect(Object.keys(object)).toEqual(["type", "id", "name", "startTime", "location"]);
  });

  it("leaves a payload without the required properties as it was built", () => {
    const object: Record<string, unknown> = { type: "civic:Process", name: "Cleanup" };
    applyWireObject(object, { process: { type: "civic.event", title: "Cleanup" } }, RECIPE);
    expect(object).toEqual({ type: "civic:Process", name: "Cleanup" });
  });

  it("treats an empty string as absent", () => {
    const object: Record<string, unknown> = { type: "civic:Process" };
    applyWireObject(object, { process: { event: { start_time: "" } } }, RECIPE);
    expect(object.type).toBe("civic:Process");
  });
});

describe("wireObjectProblem", () => {
  it("accepts a well-formed recipe", () => {
    expect(wireObjectProblem(RECIPE)).toBeNull();
  });

  it.each([
    ["a civic class", { ...RECIPE, type: "civic:Process" }],
    ["a hub class", { ...RECIPE, type: "hub:Thing" }],
    ["no properties", { ...RECIPE, properties: {} }],
    ["a path outside process", { ...RECIPE, properties: { startTime: "event.start_time" } }],
    ["a reserved property", { ...RECIPE, properties: { id: "process.event.id" } }],
    ["a hub property", { ...RECIPE, properties: { "hub:x": "process.event.x" } }],
    ["requires naming no property", { ...RECIPE, requires: ["summary"] }],
    ["empty requires", { ...RECIPE, requires: [] }],
    ["a term that is not AS2's, undeclared", { ...RECIPE, properties: { ...RECIPE.properties, timezone: "process.event.time_zone" } }],
    ["a declared term whose prefix is not", { ...RECIPE, properties: { ...RECIPE.properties, timezone: "process.event.time_zone" }, contexts: { timezone: "mz:timezone" } }],
    ["a prefix that is not an IRI", { ...RECIPE, properties: { ...RECIPE.properties, timezone: "process.event.time_zone" }, contexts: { mz: "mobilizon", timezone: "mz:timezone" } }],
    ["an AS2 term redeclared", { ...RECIPE, contexts: { startTime: "https://example.test/ns#start" } }],
  ])("refuses %s", (_label, recipe) => {
    expect(wireObjectProblem(recipe)).not.toBeNull();
  });

  it("accepts terms declared as their vocabulary publishes them (Events 2, E4)", () => {
    expect(
      wireObjectProblem({
        ...RECIPE,
        properties: { ...RECIPE.properties, timezone: "process.event.time_zone", maximumAttendeeCapacity: "process.event.capacity" },
        contexts: {
          mz: "https://mobilizon.org/ns#",
          sc: "http://schema.org/",
          timezone: { "@id": "mz:timezone", "@type": "sc:Text" },
          maximumAttendeeCapacity: "sc:maximumAttendeeCapacity",
        },
      }),
    ).toBeNull();
  });
});
