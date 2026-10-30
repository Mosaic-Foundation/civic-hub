import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HubInfo from "./HubInfo";

const hub = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../config/hub", () => ({ useHub: () => hub.current }));

describe("the hub's masthead", () => {
  it("heads a hub of another kind by its name, with its location beside the label", () => {
    hub.current = { jurisdiction: "Example Association", location: "Example County, Zedland", label: "Civic Hub", tagline: "t" };
    render(<HubInfo />);
    expect(screen.getByRole("heading", { name: "Example Association" })).toBeTruthy();
    expect(screen.getByText("Civic Hub · Example County, Zedland")).toBeTruthy();
  });

  it("shows no location when there is none", () => {
    hub.current = { jurisdiction: "Example County", location: null, label: "Civic Hub", tagline: "t" };
    render(<HubInfo />);
    expect(screen.getByText("Civic Hub")).toBeTruthy();
  });
});
