import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminRail from "./AdminRail";

vi.mock("../config/hub", () => ({ useHub: () => ({ plugins: { enabled: () => true } }) }));
vi.mock("../features", () => ({
  FEATURE_UI: [{ feature: "activity", adminTab: { label: "Activity", path: "/admin/activity", icon: "activity" } }],
}));
vi.mock("../services/api", () => ({
  adminQueueCounts: () => Promise.resolve({ reviews: 2, briefs: 0, meeting_summaries: 1, feedback: 4, edits: 3, total: 10 }),
  ADMIN_QUEUES_CHANGED: "admin-queues-changed",
}));

function rail(at = "/admin/reviews") {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AdminRail slotRef={() => {}} />
    </MemoryRouter>,
  );
}

const labels = (list: HTMLElement) => within(list).getAllByRole("link").map((a) => a.textContent?.replace(/\d+$/, "").trim());

describe("the admin rail (pilot readiness 3)", () => {
  it("has the way back and Admin at the top, then Review, Community, Activity, Hub settings, and the small foot", async () => {
    rail();
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    const links = within(nav).getAllByRole("link");
    expect(links[0]!.textContent).toBe("Back to the hub");
    expect(within(nav).getByRole("heading", { level: 2 }).textContent).toBe("Admin");
    expect(labels(screen.getByRole("list", { name: /^Review/ }))).toEqual(["Processes", "Briefs", "Meeting summaries", "Edits"]);
    expect(labels(screen.getByRole("list", { name: /^Community/ }))).toEqual(["Moderation", "Feedback"]);
    expect(labels(screen.getByRole("list", { name: "Admin" }))).toEqual(["Activity", "Hub settings"]);
    expect(labels(screen.getByRole("list", { name: "More for admins" }))).toEqual(["Archived", "Setup guide", "Contact Civic.Social"]);
  });

  it("rolls the Review items' counts, Edits included, up to the group's head", async () => {
    rail();
    const head = screen.getByRole("heading", { name: /^Review/ });
    expect((await within(head).findByLabelText("6 new since you last looked")).textContent).toBe("6");
    expect(within(screen.getByRole("heading", { name: /^Community/ })).getByText("4")).toBeTruthy();
  });

  it("opens Hub settings' sections under its item only while you're in it", () => {
    const { container, unmount } = rail("/admin/reviews");
    expect(container.querySelector(".admin-rail-subnav")).toBeNull();
    unmount();
    const inSettings = rail("/admin/settings/identity");
    expect(inSettings.container.querySelector('[data-group="main"] .admin-rail-subnav')).not.toBeNull();
  });

  it("the setup guide is the checklist in Hub settings", () => {
    rail();
    const link = screen.getByRole("link", { name: "Setup guide" });
    expect(link.getAttribute("href")).toBe("/admin/settings/getting-started");
    expect(link.getAttribute("target")).toBeNull();
  });
});
