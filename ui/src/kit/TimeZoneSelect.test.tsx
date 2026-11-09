import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimeZoneSelect } from "./TimeZoneSelect";

function Picker({ start, first = [] }: { start: string; first?: { value: string; label: string }[] }) {
  const [zone, setZone] = useState(start);
  return <TimeZoneSelect aria-label="Time zone" value={zone} onChange={setZone} first={first} />;
}

const labels = () => Array.from((screen.getByLabelText("Time zone") as HTMLSelectElement).options).map((o) => o.text);

describe("TimeZoneSelect", () => {
  it("shows seven zones in plain words, then More time zones…", () => {
    render(<Picker start="America/Chicago" />);
    expect(labels()).toEqual(["Eastern", "Central", "Mountain", "Pacific", "Alaska", "Hawaii", "Arizona", "More time zones…"]);
  });

  it("puts the page's own choice first and does not repeat it", () => {
    render(<Picker start="America/New_York" first={[{ value: "America/New_York", label: "Eastern Time, the hub's own" }]} />);
    expect(labels().slice(0, 3)).toEqual(["Eastern Time, the hub's own", "Central", "Mountain"]);
    expect(labels().filter((l) => l === "Eastern")).toEqual([]);
    expect((screen.getByLabelText("Time zone") as HTMLSelectElement).value).toBe("America/New_York");
  });

  it("keeps a saved zone that is not on the short list", () => {
    render(<Picker start="Europe/London" />);
    expect(labels()).toContain("Europe/London");
    expect((screen.getByLabelText("Time zone") as HTMLSelectElement).value).toBe("Europe/London");
  });

  it("More time zones… opens every zone and keeps the choice", () => {
    render(<Picker start="America/Chicago" />);
    const select = screen.getByLabelText("Time zone") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__more_time_zones__" } });
    expect(select.value).toBe("America/Chicago");
    expect(labels()).not.toContain("More time zones…");
    expect(labels()).toContain("UTC");
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });
    expect(select.value).toBe("Asia/Tokyo");
  });
});
