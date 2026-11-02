import { describe, expect, it } from "vitest";
import { domToMarkdown, markdownToHtml } from "./editorMarkdown";

function roundTrip(text: string): string {
  const el = document.createElement("div");
  el.innerHTML = markdownToHtml(text);
  return domToMarkdown(el);
}

describe("a field's words and the editable element", () => {
  it.each([
    "Plain words.",
    "Two paragraphs.\n\nThe second.",
    "A line\nand the next",
    "**Bold** and *italic* and **bold *both* here**.",
    "See [the terms](/terms) or [the site](https://example.test/a).",
    "- one\n- two with **bold**\n\nAfter the list.",
    "1. first\n2. second",
    "Run by {OPERATOR}. Write to {CONTACT_EMAIL}.",
    "**Run by {OPERATOR}**",
  ])("reads back as it was: %s", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("shows a placeholder as a locked chip in words, with no braces", () => {
    const el = document.createElement("div");
    el.innerHTML = markdownToHtml("Run by {OPERATOR}.");
    const chip = el.querySelector(".doc-chip") as HTMLElement;
    expect(chip.getAttribute("contenteditable")).toBe("false");
    expect(chip.textContent).toBe("operator");
    expect(el.textContent).not.toMatch(/[{}]/);
  });

  it("escapes what it is given", () => {
    const el = document.createElement("div");
    el.innerHTML = markdownToHtml('<img src=x onerror="alert(1)"> [x](javascript:"a) & more');
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x");
  });

  it("reads what browsers make when editing: div paragraphs, b and i, a space that won't collapse", () => {
    const el = document.createElement("div");
    el.innerHTML = "<div>First <b>bold</b></div><div><i>second&nbsp;one</i></div><div><br></div><ul><li>item</li></ul>";
    expect(domToMarkdown(el)).toBe("First **bold**\n\n*second one*\n\n- item");
  });

  it("keeps marks against the words", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>a<strong> bold </strong>b</p>";
    expect(domToMarkdown(el)).toBe("a **bold** b");
  });

  it("reads an empty field as empty", () => {
    expect(roundTrip("")).toBe("");
  });
});
