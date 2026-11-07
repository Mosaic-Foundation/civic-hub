import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { TYPING_FOCUS_CLASS, isTypingTarget, useTypingFocus } from "./useTypingFocus";

function Page() {
  useTypingFocus();
  return (
    <form>
      <input aria-label="name" type="search" />
      <textarea aria-label="body" />
      <input aria-label="tick" type="checkbox" />
      <div aria-label="editor" contentEditable suppressContentEditableWarning />
    </form>
  );
}

describe("typing focus (Adam's Nov 7 walk)", () => {
  it("knows which fields bring up a keyboard", () => {
    const text = document.createElement("input");
    const box = Object.assign(document.createElement("input"), { type: "checkbox" });
    const read = Object.assign(document.createElement("textarea"), { readOnly: true });
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(read)).toBe(false);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("marks the page while a text field has focus, and not for a checkbox", () => {
    vi.useFakeTimers();
    const { getByLabelText, unmount } = render(<Page />);
    const root = document.documentElement;
    act(() => getByLabelText("name").focus());
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(true);
    act(() => {
      getByLabelText("body").focus();
      vi.runAllTimers();
    });
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(true);
    act(() => {
      getByLabelText("tick").focus();
      vi.runAllTimers();
    });
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(false);
    // A press that takes focus away keeps the bar hidden until it lifts.
    act(() => getByLabelText("name").focus());
    act(() => {
      document.dispatchEvent(new Event("pointerdown"));
      getByLabelText("tick").focus();
      vi.runAllTimers();
    });
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(true);
    act(() => {
      document.dispatchEvent(new Event("pointerup"));
      vi.runAllTimers();
    });
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(false);
    act(() => getByLabelText("name").focus());
    unmount();
    expect(root.classList.contains(TYPING_FOCUS_CLASS)).toBe(false);
    vi.useRealTimers();
  });
});
