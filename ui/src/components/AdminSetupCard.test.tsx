import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminSetupCard from "./AdminSetupCard";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../services/api", () => ({ adminGetSetupCard: get, adminPostSetupCard: post }));

const step = (id: string, done: boolean) => ({ id, label: id, done, skipped: false, can_skip: false, link: "/admin/settings/identity" });
const checklist = [step("name_and_place", true), step("banner", false), step("logo", true), step("theme", false), step("copy", false)];
const steps = checklist.slice(0, 4);

function card() {
  return render(
    <MemoryRouter>
      <AdminSetupCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ dismissed: false, steps, checklist });
  post.mockReset();
});

describe("AdminSetupCard", () => {
  it("says how many of the checklist's steps are done, lists none, and offers the checklist and Dismiss (Adam, 2026-11-06)", async () => {
    card();
    expect(await screen.findByRole("heading", { name: "Set up your hub" })).toBeTruthy();
    expect(screen.getByText(/2 of 5/).closest("p")?.textContent).toBe("2 of 5 steps done");
    const bar = screen.getByRole("progressbar") as HTMLProgressElement;
    expect([bar.value, bar.max]).toEqual([2, 5]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "View your setup checklist" }).getAttribute("href")).toBe("/admin/settings/getting-started");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Dismiss"]);
  });

  it("goes away on Dismiss, which is stored", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ dismissed: true, steps, checklist });
    card();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(post).toHaveBeenCalledWith("dismiss");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up your hub" })).toBeNull());
  });

  it("shows nothing for an admin who has dismissed it", async () => {
    get.mockResolvedValue({ dismissed: true, steps, checklist });
    const { container } = card();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
