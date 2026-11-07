import { describe, expect, it } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SortableList } from "./SortableList";
import { Switch } from "./Switch";
import { moveTo } from "./sortableOrder";

function List() {
  const [ids, setIds] = useState(["a", "b", "c"]);
  return (
    <SortableList
      label="Cards"
      items={ids.map((id) => ({ id, name: id.toUpperCase() }))}
      onChange={setIds}
    />
  );
}

describe("SortableList", () => {
  it("moves one id to a place", () => {
    expect(moveTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b", "c"], "a", 5)).toEqual(["a", "b", "c"]);
  });

  it("moves a row with Up and Down, keeps the ends shut, and says where it landed", async () => {
    render(<List />);
    const names = () => screen.getAllByRole("listitem").map((li) => li.textContent?.slice(0, 1));
    expect((screen.getByRole("button", { name: "Move A up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move C down" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move C up" }));
    });
    expect(names()).toEqual(["A", "C", "B"]);
    expect(screen.getByRole("status").textContent).toBe("C, 2 of 3");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move A down" }));
    });
    expect(names()).toEqual(["C", "A", "B"]);
  });
});

describe("Switch", () => {
  it("is a checkbox read as a switch", () => {
    render(<Switch label="Show About" defaultChecked />);
    const s = screen.getByRole("switch", { name: "Show About" }) as HTMLInputElement;
    expect(s.checked).toBe(true);
    fireEvent.click(s);
    expect(s.checked).toBe(false);
  });
});
