import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessPageTop, WelcomeStripSlot } from "./PackageSlots";
import { adminQueueTabs, afterSignUpStop } from "./packageContributions";

const on = new Set<string>();
const hub = { plugins: { enabled: (p: string) => on.has(p) } };

vi.mock("../config/hub", () => ({ useHub: () => hub }));
vi.mock("../processes/display", () => ({
  pluginOfType: (type: string) => ({ "civic.brief": "brief", "civic.wordcloud": "wordcloud", "civic.vote": "vote" })[type],
}));
vi.mock("../processes", () => ({
  PROCESS_UI: [
    { type: "civic.vote", routes: [] },
    {
      type: "civic.brief",
      routes: [],
      contributes: {
        processTop: ({ processId }: { processId: string }) => <p>Brief of {processId}</p>,
        adminQueue: { queue: "briefs", label: "Briefs", icon: "outcome", path: "/admin/briefs" },
      },
    },
    {
      type: "civic.wordcloud",
      routes: [],
      contributes: { welcomeStrip: () => <p>The word cloud</p>, afterSignUp: (back: string | null) => `/wordcloud/w1?back=${back}` },
    },
  ],
}));

beforeEach(() => on.clear());

describe("what packages add to the kernel's pages (kernel step 3)", () => {
  it("draws a package's addition to a process page while its plugin is on", () => {
    on.add("brief");
    render(<ProcessPageTop processId="p1" />);
    expect(screen.getByText("Brief of p1")).toBeTruthy();
  });

  it("draws nothing for a package whose plugin is off", () => {
    const { container } = render(<ProcessPageTop processId="p1" />);
    expect(container.textContent).toBe("");
    expect(adminQueueTabs(hub as never)).toEqual([]);
  });

  it("lists the review queues and the welcome strip of the packages that are on", () => {
    on.add("brief");
    on.add("wordcloud");
    expect(adminQueueTabs(hub as never).map((q) => q.label)).toEqual(["Briefs"]);
    render(<WelcomeStripSlot />);
    expect(screen.getByText("The word cloud")).toBeTruthy();
  });

  it("sends a new member to a package's stop only while it is on, with a checked way back", () => {
    expect(afterSignUpStop(hub as never, "/process/a")).toBeNull();
    on.add("wordcloud");
    expect(afterSignUpStop(hub as never, "/process/a")).toBe("/wordcloud/w1?back=/process/a");
    expect(afterSignUpStop(hub as never, "https://elsewhere.example")).toBe("/wordcloud/w1?back=null");
  });
});
