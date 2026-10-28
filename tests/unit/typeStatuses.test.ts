// A type's own statuses (engine 2, A4): declared in its manifest, each a case
// of one of the hub's states; read models carry the word, the hub's status
// stays what the descriptor and the wire serve.

import { describe, expect, it } from "vitest";
import { checkManifests } from "../../src/processes/manifest.js";
import { typeStatusOf } from "../../src/processes/registry.js";
import { MANIFEST_LIST } from "../../src/shared/processManifests.js";
import { THEME_TYPE_KEYS } from "../../src/shared/theme.js";

const statuses = {
  declared: [
    { id: "scheduled", label: "Scheduled", hub: "active" as const },
    { id: "past", label: "Past", hub: "closed" as const },
    { id: "cancelled", label: "Cancelled", hub: "closed" as const },
  ],
  of: (p: { status: string; state: Record<string, unknown> }) =>
    p.state.cancelled ? "cancelled" : p.status === "closed" ? "past" : "scheduled",
};
const HOST = { colors: [...THEME_TYPE_KEYS], hostActivityTypes: [], hostTables: [], featureIds: [] };
const base = MANIFEST_LIST.find((m) => m.descriptor.type === "civic.event")!;

describe("a type's own statuses", () => {
  it("name the declared word for a process, from its hub status and state", () => {
    const m = { ...base, statuses } as never;
    expect(typeStatusOf(m, { status: "active", state: {} })).toEqual({ id: "scheduled", label: "Scheduled" });
    expect(typeStatusOf(m, { status: "closed", state: {} })).toEqual({ id: "past", label: "Past" });
    expect(typeStatusOf(m, { status: "closed", state: { cancelled: true } })).toEqual({ id: "cancelled", label: "Cancelled" });
  });

  it("read as none for a type without them, or an answer it did not declare", () => {
    expect(typeStatusOf({ ...base, statuses: undefined } as never, { status: "active", state: {} })).toBeNull();
    expect(typeStatusOf({ ...base, statuses: { ...statuses, of: () => "nope" } } as never, { status: "active", state: {} })).toBeNull();
  });

  it("are refused at startup when one maps to a state the type does not have", () => {
    const bad = { ...base, statuses: { ...statuses, declared: [{ id: "held", label: "Held", hub: "finalized" }] } };
    expect(() => checkManifests([bad] as never, HOST as never)).toThrow(/not one of its states/);
    const dup = { ...base, statuses: { ...statuses, declared: [statuses.declared[0], statuses.declared[0]] } };
    expect(() => checkManifests([dup] as never, HOST as never)).toThrow(/unique/);
  });
});
