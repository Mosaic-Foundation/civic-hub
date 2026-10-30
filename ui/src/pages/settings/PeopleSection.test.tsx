import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PeopleSection from "./PeopleSection";

const people = vi.fn();

vi.mock("../../config/hub", () => ({ useHub: () => ({ plugins: { enabled: () => false } }) }));
vi.mock("./hubSettingsState", () => ({ useHubSettings: () => ({ setDirty: () => {} }), useUnsavedChangesGuard: () => {} }));
vi.mock("../../services/api", () => ({
  adminGetHubPeople: () => people(),
  adminGetHiddenMembers: vi.fn(),
  adminRequestPeopleCode: vi.fn(),
  adminSetHubPeople: vi.fn(),
}));

function section() {
  render(
    <MemoryRouter>
      <PeopleSection />
    </MemoryRouter>,
  );
}

describe("Settings → Admins", () => {
  it("is about admins only, and points board members to Officials", async () => {
    people.mockResolvedValue({ admin_emails: ["a@example.test"], board_emails: [] });
    section();
    expect(await screen.findByLabelText("Admins 1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Admins/ })).toBeTruthy();
    expect(screen.queryByText(/board list/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /board/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Officials" }).getAttribute("href")).toBe("/admin/settings/officials");
  });

  it("still shows a hub its old board list, to move and remove, not to add to", async () => {
    people.mockResolvedValue({ admin_emails: ["a@example.test"], board_emails: ["b@example.test"] });
    section();
    expect(((await screen.findByLabelText("Old board list 1")) as HTMLInputElement).value).toBe("b@example.test");
    expect(screen.getByRole("button", { name: "Remove Old board list 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add board/ })).toBeNull();
  });
});
