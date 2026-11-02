import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HubReadyDialog from "./HubReadyDialog";
import { PLATFORM_SETUP_GUIDE_URL } from "../../../src/shared/platform";

vi.mock("../config/hub", () => ({ useHub: () => ({ name: "Sample Hub" }) }));

describe("HubReadyDialog", () => {
  it("carries what the intro email carries: the first steps and the guide", () => {
    render(
      <MemoryRouter>
        <HubReadyDialog email="new@example.test" onDismiss={() => {}} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole("dialog", { name: "Your hub is ready." });
    expect(dialog.textContent).toContain("Your first steps");
    expect(dialog.querySelectorAll("ol li")).toHaveLength(3);
    expect(dialog.textContent).toContain("Under Admins, add anyone");
    expect(dialog.textContent).toContain("new@example.test");
    const guide = screen.getByRole("link", { name: "Setup guide" });
    expect(guide.getAttribute("href")).toBe(PLATFORM_SETUP_GUIDE_URL);
    expect(guide.getAttribute("target")).toBe("_blank");
    // Beside Open Hub settings, with the same weight.
    const settings = screen.getByRole("button", { name: "Open Hub settings" });
    expect(guide.className).toBe(settings.className);
    expect(guide.parentElement).toBe(settings.parentElement);
  });

  it("says the work keeps", () => {
    render(
      <MemoryRouter>
        <HubReadyDialog email="new@example.test" onDismiss={() => {}} />
      </MemoryRouter>,
    );
    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain("also in the email we sent to new@example.test");
    expect(text).toContain("its own Save");
    expect(text).toContain("what you've saved stays");
  });
});
