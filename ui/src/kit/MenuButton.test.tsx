import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuButton } from "./MenuButton";

const LINKS = [
  { label: "Google", href: "https://calendar.example/add", newTab: true },
  { label: "Another app (.ics file)", href: "/event.ics", download: true },
];

describe("MenuButton", () => {
  it("is a closed pill until pressed, then a menu of its links", () => {
    render(<MenuButton label="Add to my calendar" links={LINKS} />);
    const pill = screen.getByRole("button", { name: "Add to my calendar" });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Google", "Another app (.ics file)"]);
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens another site in a new tab, and saves a download", () => {
    render(<MenuButton label="Add to my calendar" links={LINKS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to my calendar" }));
    const [google, file] = screen.getAllByRole("menuitem");
    expect(google!.getAttribute("target")).toBe("_blank");
    expect(google!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(file!.hasAttribute("download")).toBe(true);
    expect(file!.hasAttribute("target")).toBe(false);
  });

  it("moves with the arrow keys and closes on Escape, focus back on the pill", () => {
    render(<MenuButton label="Add to my calendar" links={LINKS} />);
    const pill = screen.getByRole("button", { name: "Add to my calendar" });
    fireEvent.click(pill);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Another app (.ics file)");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it("closes on a press outside", () => {
    render(<MenuButton label="Add to my calendar" links={LINKS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to my calendar" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
