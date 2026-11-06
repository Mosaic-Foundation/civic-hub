import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GettingStartedSection from "./GettingStartedSection";
import { HELP, helpUrl } from "../../../../src/shared/helpRegistry";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../services/api", () => ({ adminGetSetupCard: get, adminPostSetupCard: post }));

const step = (id: string, label: string, done: boolean, link: string, help: string, extra = {}) => ({
  id,
  label,
  hint: `Why ${label}.`,
  done,
  skipped: false,
  can_skip: false,
  link,
  help,
  ...extra,
});

const checklist = [
  step("name_and_place", "Name and place set", true, "/admin/settings/identity", "identity.name"),
  step("banner", "A banner image", false, "/admin/settings/identity", "identity.banner_url"),
  step("second_admin", "A second admin added", false, "/admin/settings/people", "people.admins", { can_skip: true }),
  step("beta", "Moved to beta", false, "/admin/settings/mode", "settings.mode"),
];

beforeEach(() => {
  get.mockReset().mockResolvedValue({ dismissed: false, steps: checklist.slice(0, 4), checklist });
  post.mockReset();
});

function section() {
  return render(
    <MemoryRouter>
      <GettingStartedSection />
    </MemoryRouter>,
  );
}

describe("Hub settings → Getting started", () => {
  it("lists every step with its tick, a link to the setting and a link to its docs page", async () => {
    section();
    expect(await screen.findByText("1 of 4 done")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-step"))).toEqual(["name_and_place", "banner", "second_admin", "beta"]);
    expect(items[0]!.className).toContain("is-done");
    expect(items[1]!.className).not.toContain("is-done");
    const banner = within(items[1]!);
    expect(banner.getByRole("link", { name: "A banner image" }).getAttribute("href")).toBe("/admin/settings/identity");
    const docs = banner.getByRole("link", { name: /Read about it/ });
    expect(docs.getAttribute("href")).toBe(helpUrl(HELP["identity.banner_url"]!));
    expect(docs.getAttribute("target")).toBe("_blank");
  });

  it("offers Skip on the second admin, and shows it skipped", async () => {
    const user = userEvent.setup();
    const skipped = checklist.map((s) => (s.id === "second_admin" ? { ...s, done: true, skipped: true, can_skip: true } : s));
    post.mockResolvedValue({ dismissed: false, steps: skipped.slice(0, 4), checklist: skipped });
    section();
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(post).toHaveBeenCalledWith("skip_second_admin");
    expect(await screen.findByText(/You skipped this/)).toBeTruthy();
    expect(screen.getByText("2 of 4 done")).toBeTruthy();
  });
});
