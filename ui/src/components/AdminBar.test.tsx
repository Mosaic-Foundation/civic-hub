import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminBar from "./AdminBar";
import NavItemList from "./NavItemList";
import { useAdminNav } from "../hooks/useAdminNav";
import { PLATFORM_SETUP_GUIDE_URL } from "../../../src/shared/platform";

vi.mock("../config/hub", () => ({ useHub: () => ({ plugins: { enabled: () => true } }) }));
vi.mock("../features", () => ({ FEATURE_UI: [] }));
vi.mock("../services/api", () => ({
  adminQueueCounts: () => Promise.resolve({ reviews: 0, briefs: 0, meeting_summaries: 0, feedback: 0, edits: 0, total: 0 }),
  ADMIN_QUEUES_CHANGED: "admin-queues-changed",
}));

function Column() {
  return <NavItemList className="list" items={useAdminNav()} label="Admin" />;
}

describe("the Setup guide link", () => {
  for (const [where, Nav] of [
    ["the admin bar", AdminBar],
    ["the left column's list", Column],
  ] as const) {
    it(`is on ${where}, opening the guide in a new tab`, () => {
      render(
        <MemoryRouter initialEntries={["/admin/settings"]}>
          <Nav />
        </MemoryRouter>,
      );
      const link = screen.getByRole("link", { name: "Setup guide" });
      expect(link.getAttribute("href")).toBe(PLATFORM_SETUP_GUIDE_URL);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener");
    });
  }
});
