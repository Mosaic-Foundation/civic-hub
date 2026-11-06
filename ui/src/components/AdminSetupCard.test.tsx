import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminSetupCard from "./AdminSetupCard";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../services/api", () => ({ adminGetSetupCard: get, adminPostSetupCard: post }));

const steps = [
  { id: "name_and_place", label: "Name and place set", done: true, skipped: false, can_skip: false, link: "/admin/settings/identity" },
  { id: "second_admin", label: "A second admin added", done: false, skipped: false, can_skip: true, link: "/admin/settings/people" },
];

function card() {
  return render(
    <MemoryRouter>
      <AdminSetupCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ dismissed: false, steps });
  post.mockReset();
});

describe("AdminSetupCard", () => {
  it("shows the steps with their ticks, the way to the checklist and Dismiss, and nothing else", async () => {
    card();
    expect(await screen.findByRole("heading", { name: "Set up your hub" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Name and place set" }).closest("li")?.className).toContain("is-done");
    expect(screen.getByRole("link", { name: "A second admin added" }).closest("li")?.className).not.toContain("is-done");
    expect(screen.getByRole("link", { name: "View your setup checklist" }).getAttribute("href")).toBe("/admin/settings/getting-started");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Skip", "Dismiss"]);
    expect(screen.queryByRole("link", { name: "Setup guide" })).toBeNull();
  });

  it("goes away on Dismiss, which is stored", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ dismissed: true, steps });
    card();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(post).toHaveBeenCalledWith("dismiss");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up your hub" })).toBeNull());
  });

  it("shows nothing for an admin who has dismissed it", async () => {
    get.mockResolvedValue({ dismissed: true, steps });
    const { container } = card();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("offers Skip on the second admin and says it was skipped", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ dismissed: false, steps: [steps[0], { ...steps[1], done: true, skipped: true }] });
    card();
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(post).toHaveBeenCalledWith("skip_second_admin");
    expect(await screen.findByText(/You skipped this/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
});
