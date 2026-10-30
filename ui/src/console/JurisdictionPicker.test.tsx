import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JurisdictionPicker, crossesPlace, type JurisdictionChoice, type JurisdictionSource } from "./JurisdictionPicker";
import type { Jurisdiction, JurisdictionMatch } from "./api";

const row = (name: string, state = "XA"): JurisdictionMatch =>
  ({ ocd_id: `ocd-division/country:us/state:xa/county:${name.toLowerCase()}`, display_name: `${name} County, Xland`, official_name: `${name} County`, type: "county", state, census_geoid: "00000", hubs: [] }) as unknown as JurisdictionMatch;

const search = vi.fn<JurisdictionSource["searchJurisdictions"]>();
const source: JurisdictionSource = {
  states: () =>
    Promise.resolve({
      states: [
        { ocd_id: "a", state: "XA", official_name: "Xland" },
        { ocd_id: "b", state: "YA", official_name: "Yland" },
      ] as unknown as Jurisdiction[],
    }),
  searchJurisdictions: search,
};

let latest: JurisdictionChoice = { kind: "unlinked" };
function Harness() {
  const [value, setValue] = useState<JurisdictionChoice>({ kind: "unlinked" });
  return (
    <JurisdictionPicker
      value={value}
      onChange={(next) => {
        latest = next;
        setValue(next);
      }}
      source={source}
      plain
    />
  );
}

async function pick(name: string) {
  const user = userEvent.setup();
  render(<Harness />);
  await user.selectOptions(await screen.findByLabelText("State"), "XA");
  await user.selectOptions(screen.getByLabelText("Type"), "county");
  const field = screen.getByRole("combobox", { name: "Name" }) as HTMLInputElement;
  await user.type(field, name.slice(0, 2));
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
  expect(field.value).toBe(`${name} County, Xland`);
  return { user, field };
}

beforeEach(() => {
  search.mockReset();
  search.mockImplementation((_s, _t, q) =>
    Promise.resolve({ matches: [row("Alder"), row("Birch")].filter((m) => m.display_name.toLowerCase().includes(q.toLowerCase())) }),
  );
});

describe("the place Name field", () => {
  it("has a clear control: the pick goes, and another can be picked", async () => {
    const { user, field } = await pick("Alder");
    await user.click(screen.getByRole("button", { name: /Clear Alder/ }));
    expect(field.value).toBe("");
    expect(latest.kind).toBe("unlinked");
    expect(document.activeElement).toBe(field);
    await user.type(field, "Bi");
    await user.click(await screen.findByRole("option", { name: /Birch/ }));
    expect(field.value).toBe("Birch County, Xland");
    expect(latest.kind).toBe("listed");
  });

  it("lets typing replace the pick, without the old name in the search", async () => {
    const { user, field } = await pick("Alder");
    await user.keyboard("Bi");
    expect(latest.kind).toBe("unlinked");
    expect(field.value).toBe("Bi");
    await user.click(await screen.findByRole("option", { name: /Birch/ }));
    expect(field.value).toBe("Birch County, Xland");
  });

  it("clears the whole name on one backspace, and stays clear after leaving the field", async () => {
    const { user, field } = await pick("Alder");
    await user.keyboard("{Backspace}");
    expect(field.value).toBe("");
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(field.value).toBe("");
    expect(latest.kind).toBe("unlinked");
  });

  it("drops the pick when the state or the type changes", async () => {
    const { user, field } = await pick("Alder");
    await user.selectOptions(screen.getByLabelText("State"), "YA");
    expect(field.value).toBe("");
    expect(latest.kind).toBe("unlinked");
  });
});

describe("crossesPlace", () => {
  it("is true to or from a place hub, and only then", () => {
    expect(crossesPlace("place", "other")).toBe(true);
    expect(crossesPlace("issue", "place")).toBe(true);
    expect(crossesPlace("issue", "other")).toBe(false);
    expect(crossesPlace("place", "place")).toBe(false);
  });
});
