import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount what each test rendered (testing-library does this itself only with globals on).
afterEach(() => cleanup());

// jsdom's <dialog> has no showModal() or close(): the open attribute only,
// as a browser's does without the top layer (the inert page behind a modal
// is the browser's, checked in Playwright).
const Dialog = (globalThis as { HTMLDialogElement?: typeof HTMLElement }).HTMLDialogElement ?? HTMLElement;
const proto = Dialog.prototype as unknown as Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  Object.defineProperty(proto, "open", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("open");
    },
    set(this: HTMLElement, value: boolean) {
      this.toggleAttribute("open", value);
    },
  });
  proto.showModal = function (this: HTMLElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
