import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SampleRefresh from "./SampleRefresh";

const refresh = vi.fn();

vi.mock("../../config/hubConfig", () => ({ refreshHubConfig: vi.fn() }));
vi.mock("../../components/deletableSample", () => ({ forgetSampleIds: vi.fn() }));
vi.mock("../../services/api", () => ({ adminRefreshSamples: () => refresh() }));

const summary = { processes: 11, by_type: {}, users: 3, real_input: {}, real_input_total: 0, other_processes: 2, items: [] };

describe("Settings → Sample content → Refresh samples (2026-11-05)", () => {
  it("says what it replaced and added, by title, and hands back the new summary", async () => {
    refresh.mockResolvedValue({
      refresh: { replaced: [{ key: "vote_internet", reason: "x" }], added: ["wordcloud_value"], minutes_added: [] },
      titles: { vote_internet: "Which internet access step?", wordcloud_value: "What do you value?" },
      summary,
    });
    const onRefreshed = vi.fn();
    render(<SampleRefresh onRefreshed={onRefreshed} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh samples" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "Replaced with a fresh copy: “Which internet access step?”. Added: “What do you value?”.",
    );
    expect(onRefreshed).toHaveBeenCalledWith(summary);
  });

  it("says so when nothing needed changing", async () => {
    refresh.mockResolvedValue({ refresh: { replaced: [], added: [], minutes_added: [] }, titles: {}, summary });
    render(<SampleRefresh onRefreshed={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh samples" }));
    expect((await screen.findByRole("status")).textContent).toBe("Every sample is current; nothing changed.");
  });

  it("shows the server's refusal", async () => {
    refresh.mockRejectedValue(new Error("Samples are refreshed on demo and beta hubs only; this hub is live."));
    render(<SampleRefresh onRefreshed={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh samples" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/demo and beta hubs only/);
  });
});
