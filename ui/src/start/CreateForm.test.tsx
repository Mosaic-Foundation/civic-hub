import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateForm from "./CreateForm";
import type { JurisdictionMatch } from "../console/api";

const bent = {
  ocd_id: "ocd-division/country:us/state:xa/county:alder",
  display_name: "Alder County, Xland",
  official_name: "Alder County",
  type: "county",
  state: "XA",
  census_geoid: "00000",
  hubs: [],
} as unknown as JurisdictionMatch;

vi.mock("./api", () => ({
  StartApiError: class extends Error {},
  startApi: {
    config: () => Promise.resolve({ hub_domain: "example.test", sample_kinds: [] }),
    suggestSlug: () => Promise.resolve({ slug: "alder", available: true }),
    createHub: vi.fn(),
    legal: vi.fn(),
  },
  startJurisdictions: {
    states: () => Promise.resolve({ states: [{ ocd_id: "a", state: "XA", official_name: "Xland" }] }),
    searchJurisdictions: () => Promise.resolve({ matches: [bent] }),
  },
}));

function form() {
  return render(<CreateForm email="a@example.test" onSessionEnded={() => {}} onLeave={() => {}} />);
}

async function pickPlace(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("State"), "XA");
  await user.selectOptions(screen.getByLabelText("Type"), "county");
  await user.type(screen.getByRole("combobox", { name: "Name" }), "Al");
  await user.click(await screen.findByRole("option", { name: /Alder/ }));
}

describe("the start page's Kind of hub", () => {
  it("updates the form at once, a chosen place included", async () => {
    const user = userEvent.setup();
    form();
    await pickPlace(user);
    expect(screen.getByRole("group", { name: "Jurisdiction" })).toBeTruthy();
    expect(screen.getByLabelText(/Governing body/)).toBeTruthy();
    expect(screen.getByLabelText(/^Hub name/).getAttribute("placeholder")).toContain("Alder");

    await user.click(screen.getByRole("radio", { name: /^Other\s*Anything else/ }));

    expect(screen.getByRole("group", { name: "Location" })).toBeTruthy();
    expect(screen.queryByLabelText(/Governing body/)).toBeNull();
    expect(screen.queryByLabelText("Place name")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Name" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText(/^Hub name/).getAttribute("placeholder")).not.toContain("Alder");
  });

  it("asks for a place again on coming back to Place", async () => {
    const user = userEvent.setup();
    form();
    await screen.findByLabelText("State");
    await user.click(screen.getByRole("radio", { name: /^Other\s*Anything else/ }));
    await user.click(screen.getByRole("radio", { name: /^Jurisdiction\s*A local/ }));
    expect(screen.getByRole("group", { name: "Jurisdiction" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Name" })).toBeTruthy();
  });

  it("offers a typed place only to a neighbourhood or association", async () => {
    const user = userEvent.setup();
    form();
    await screen.findByLabelText("State");
    expect(screen.queryByRole("radio", { name: /Other \/ not listed/ })).toBeNull();

    await user.click(screen.getByRole("radio", { name: /^Neighbourhood or association/ }));
    await user.click(screen.getByRole("radio", { name: /Other \/ not listed/ }));
    await user.type(screen.getByLabelText(/^Its name/), "Example Homeowners");
    expect(screen.getByLabelText(/^Hub name/).getAttribute("placeholder")).toContain("Example Homeowners");

    // Moving to a kind without it drops the typed place at once.
    await user.click(screen.getByRole("radio", { name: /^Issue campaign/ }));
    expect(screen.queryByLabelText(/^Its name/)).toBeNull();
    expect(screen.queryByRole("radio", { name: /Other \/ not listed/ })).toBeNull();
    expect((screen.getByRole("combobox", { name: "Name" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("asks where the hub is for every kind, and needs it only for a jurisdiction", async () => {
    const user = userEvent.setup();
    form();
    await screen.findByLabelText("State");
    await user.type(screen.getByLabelText(/^Hub name/), "Example Association");
    await user.type(screen.getByLabelText("Web address"), "example-assoc");
    const create = screen.getByRole("button", { name: "Create my hub" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    for (const kind of [/^Neighbourhood or association/, /^Issue campaign/, /^Organization or club/, /^Other\s*Anything/]) {
      await user.click(screen.getByRole("radio", { name: kind }));
      expect(screen.getByRole("group", { name: "Location" })).toBeTruthy();
      expect(screen.getByLabelText("State")).toBeTruthy();
      expect(create.disabled).toBe(false);
    }
  });
});
