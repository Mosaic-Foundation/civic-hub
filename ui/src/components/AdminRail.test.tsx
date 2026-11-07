import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminRail from "./AdminRail";
import { RAIL_GROUPS_KEY } from "../hooks/useRailGroups";

vi.mock("../config/hub", () => ({ useHub: () => ({ plugins: { enabled: () => true } }) }));
vi.mock("../features", () => ({
  FEATURE_UI: [{ feature: "activity", adminTab: { label: "Activity", path: "/admin/activity", icon: "activity" } }],
}));
vi.mock("../services/api", () => ({
  adminQueueCounts: () => Promise.resolve({ reviews: 2, briefs: 0, meeting_summaries: 1, feedback: 4, edits: 3, total: 10 }),
  ADMIN_QUEUES_CHANGED: "admin-queues-changed",
}));

function rail(at = "/admin/reviews", slot = true) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AdminRail {...(slot ? { slotRef: () => {} } : {})} />
    </MemoryRouter>,
  );
}

const labels = (list: HTMLElement) => within(list).getAllByRole("link").map((a) => a.textContent?.replace(/\d+$/, "").trim());
const toggle = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => window.localStorage.clear());

describe("the admin rail (pilot readiness 3; folding groups, Nov 7)", () => {
  it("has the way back and Admin at the top, then Review, Community, Activity, Hub settings, and the small foot", () => {
    rail();
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getAllByRole("link")[0]!.textContent).toBe("Back to the hub");
    expect(within(nav).getByRole("heading", { level: 2 }).textContent).toBe("Admin");
    expect(within(nav).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.replace(/\d+$/, ""))).toEqual([
      "Review",
      "Community",
      "Hub settings",
    ]);
    expect(labels(screen.getByRole("list", { name: "Review" }))).toEqual(["Processes", "Briefs", "Meeting summaries", "Edits"]);
    expect(labels(screen.getByRole("list", { name: "Activity" }))).toEqual(["Activity"]);
    expect(labels(screen.getByRole("list", { name: "More for admins" }))).toEqual(["Archived", "Setup guide", "Contact Civic.Social"]);
  });

  it("opens the group holding the page and starts the others closed", () => {
    rail("/admin/reviews");
    expect(toggle(/^Review/).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(/^Community/).getAttribute("aria-expanded")).toBe("false");
    expect(toggle(/^Hub settings/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: /^Processes/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Moderation/ })).toBeNull();
  });

  it("rolls a closed group's counts up to its heading, and an open group leaves them on its items", async () => {
    rail("/admin/reviews");
    const community = toggle(/^Community/);
    expect((await within(community).findByLabelText("4 new since you last looked")).textContent).toBe("4");
    expect(within(toggle(/^Review/)).queryByLabelText(/new since/)).toBeNull();
    expect(await screen.findByLabelText("2 new since you last looked")).toBeTruthy();
  });

  it("remembers what you open and close, in this browser", () => {
    const first = rail("/admin/reviews");
    fireEvent.click(toggle(/^Community/));
    fireEvent.click(toggle(/^Review/));
    expect(JSON.parse(window.localStorage.getItem(RAIL_GROUPS_KEY)!)).toMatchObject({ community: true, review: false });
    first.unmount();
    rail("/admin/archived");
    expect(toggle(/^Community/).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(/^Review/).getAttribute("aria-expanded")).toBe("false");
  });

  it("lists Hub settings' sections as links away from its page, and gives its page the slot on it", () => {
    const away = rail("/admin/reviews");
    fireEvent.click(toggle(/^Hub settings/));
    const list = screen.getByRole("list", { name: "Hub settings" });
    expect(labels(list)[0]).toBe("Getting started");
    expect(within(list).getByRole("link", { name: "Appearance" }).getAttribute("href")).toBe("/admin/settings/theme");
    away.unmount();
    const on = rail("/admin/settings/identity");
    expect(toggle(/^Hub settings/).getAttribute("aria-expanded")).toBe("true");
    expect(on.container.querySelector('[data-group="settings"] .admin-rail-subnav')).not.toBeNull();
    // Closed, the slot stays, so the page doesn't draw its list again in its own column.
    fireEvent.click(toggle(/^Hub settings/));
    expect(on.container.querySelector('[data-group="settings"] .admin-rail-subnav')).not.toBeNull();
  });

  it("in the drawer (no slot), Hub settings' sections are plain links, the current one marked", () => {
    rail("/admin/settings/legal", false);
    const list = screen.getByRole("list", { name: "Hub settings" });
    expect(within(list).getByRole("link", { name: "Legal" }).getAttribute("aria-current")).toBe("page");
  });

  it("the setup guide is the checklist in Hub settings", () => {
    rail();
    const link = screen.getByRole("link", { name: "Setup guide" });
    expect(link.getAttribute("href")).toBe("/admin/settings/getting-started");
    expect(link.getAttribute("target")).toBeNull();
  });
});
