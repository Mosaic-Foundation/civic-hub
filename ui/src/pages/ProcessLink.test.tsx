import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProcessLink, { type ProcessLinkPage } from "./ProcessLink";

const on = new Set<string>();
const state = { current: { id: "p1", type: "civic.proposal" } as { id: string; type: string } };

vi.mock("../config/hub", () => ({ useHub: () => ({ plugins: { enabled: (p: string) => on.has(p) } }) }));
vi.mock("../services/api", () => ({ getProcessState: () => Promise.resolve(state.current) }));
vi.mock("../processes/display", () => ({
  detailPathOf: (type: string, id: string) => (type === "civic.proposal" ? `/proposal/${id}` : `/process/${id}`),
  pluginOfType: (type: string) => ({ "civic.proposal": "proposals", "civic.vote": "vote" })[type],
}));

const pages: ProcessLinkPage[] = [{ type: "civic.vote", plugin: "vote", element: <p>The vote's page</p> }];

function open(at = "/process/p1") {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/process/:id" element={<ProcessLink pages={pages} />} />
        <Route path="/proposal/:id" element={<p>The proposal's page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => on.clear());

describe("the kernel's /process/:id link (kernel step 3)", () => {
  it("is the vote's page while Votes is on", () => {
    on.add("vote");
    open();
    expect(screen.getByText("The vote's page")).toBeTruthy();
  });

  it("sends an old link to the process's own page with Votes off", async () => {
    on.add("proposals");
    open();
    expect(await screen.findByText("The proposal's page")).toBeTruthy();
  });

  it("shows page not found for a vote with Votes off", async () => {
    state.current = { id: "p1", type: "civic.vote" };
    open();
    expect(await screen.findByText("Page not found")).toBeTruthy();
    state.current = { id: "p1", type: "civic.proposal" };
  });
});
