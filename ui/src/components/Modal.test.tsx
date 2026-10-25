import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";

// jsdom has no showModal (Modal then opens the dialog with the attribute):
// the page-behind-is-inert focus trap is the browser's, checked in Playwright
// (tests/e2e/frontendPass.spec.ts). This covers the component's own part.

function Harness({ dismissible = true, onClose = () => {} }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal
          title="Confirm it"
          dismissible={dismissible}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input aria-label="Name" />
          <button>Save</button>
        </Modal>
      )}
    </>
  );
}

describe("Modal", () => {
  it("is labelled by its title and focuses its first field", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog", { name: "Confirm it" });
    expect(dialog).toHaveProperty("open", true);
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("Escape asks to close, and focus goes back to what opened it", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText("Open");
    await userEvent.click(opener);
    // Escape on a modal <dialog> fires "cancel"; the Modal turns it into onClose.
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("the × button and a backdrop click close it", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByText("Open"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("while saving (not dismissible) Escape, × and the backdrop do nothing", async () => {
    const onClose = vi.fn();
    render(<Harness dismissible={false} onClose={onClose} />);
    await userEvent.click(screen.getByText("Open"));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("marks the page while open, and clears the mark when the last one closes", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    expect(document.documentElement.classList.contains("modal-open")).toBe(true);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(document.documentElement.classList.contains("modal-open")).toBe(false);
  });
});
