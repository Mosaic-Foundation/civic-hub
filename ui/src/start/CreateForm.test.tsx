import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateForm from "./CreateForm";
import { startApi } from "./api";
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
    checkSlug: vi.fn(),
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

describe("the start page's web address", () => {
  it("says a typed address is taken, offers a free one and won't create", async () => {
    const user = userEvent.setup();
    vi.mocked(startApi.checkSlug).mockResolvedValue({ available: false, reason: "taken", suggestion: "alder-xa" });
    form();
    await pickPlace(user);
    await user.type(screen.getByLabelText("Web address"), "alder");
    expect((await screen.findByRole("alert")).textContent).toContain("alder.example.test is taken.");
    expect((screen.getByRole("button", { name: "Create my hub" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Use alder-xa" }));
    expect((screen.getByLabelText("Web address") as HTMLInputElement).value).toBe("alder-xa");
  });

  it("says a typed address is free", async () => {
    const user = userEvent.setup();
    vi.mocked(startApi.checkSlug).mockResolvedValue({ available: true, reason: null, suggestion: null });
    form();
    await user.type(await screen.findByLabelText("Web address"), "northside");
    expect(await screen.findByText(/^Available\./)).toBeTruthy();
  });
});

describe("the start page's Operated by", () => {
  it("starts empty, suggests nothing and says what blank means", async () => {
    form();
    const field = (await screen.findByLabelText(/^Operated by/)) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.getAttribute("placeholder")).toBeNull();
    expect(screen.getByText(/operated by its administrators/)).toBeTruthy();
  });
});

describe("Create my hub", () => {
  it("shows it is creating until the hub answers", async () => {
    const user = userEvent.setup();
    vi.mocked(startApi.createHub).mockReturnValue(new Promise(() => {}));
    vi.mocked(startApi.checkSlug).mockResolvedValue({ available: true, reason: null, suggestion: null });
    form();
    await pickPlace(user);
    await waitFor(() => expect((screen.getByRole("button", { name: "Create my hub" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Create my hub" }));
    const busy = await screen.findByRole("button", { name: /Creating your hub/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the creation form and form fill (pilot readiness 3)", () => {
  it("asks browsers and password managers not to fill any field but the contact address", async () => {
    const user = userEvent.setup();
    const { container } = form();
    await pickPlace(user);
    const fields = [...container.querySelectorAll("input, select")].filter(
      (el) => !["radio", "checkbox", "hidden"].includes((el as HTMLInputElement).type),
    ) as HTMLInputElement[];
    expect(fields.length).toBeGreaterThanOrEqual(8);
    for (const el of fields) {
      const label = el.labels?.[0]?.textContent ?? el.name;
      if (el.type === "email") {
        expect(el.getAttribute("autocomplete"), label).toBe("email");
        continue;
      }
      expect(el.getAttribute("autocomplete"), label).toBe("off");
      expect(el.getAttribute("data-1p-ignore"), label).toBe("true");
      expect(el.getAttribute("data-lpignore"), label).toBe("true");
      // No name an address book would recognise.
      expect(el.name, label).not.toMatch(/name|state|city|address|org|company|street|zip|postal|country|tel/i);
    }
  });

  it("the place search ignores a value put into it rather than typed, and takes only a pick from its list", async () => {
    const user = userEvent.setup();
    form();
    await user.selectOptions(await screen.findByLabelText("State"), "XA");
    await user.selectOptions(screen.getByLabelText("Type"), "county");
    const search = screen.getByRole("combobox", { name: "Name" }) as HTMLInputElement;
    expect(document.activeElement).not.toBe(search);
    // What a password manager does: set the value and fire the event, without focusing the field.
    fireEvent.change(search, { target: { value: "Alder County, Xland" } });
    fireEvent.input(search, { target: { value: "Alder County, Xland" } });
    await waitFor(() => expect(search.value).toBe(""));
    expect(screen.queryByRole("option", { name: /Alder/ })).toBeNull();
    expect(screen.getByLabelText(/^Hub name/).getAttribute("placeholder") ?? "").not.toContain("Alder");
    expect(screen.queryByLabelText("Place name")).toBeNull();
  });
});
