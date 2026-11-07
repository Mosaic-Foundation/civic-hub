// While someone is typing, the phone gives the keyboard the room (Adam's Nov 7
// walk: the bottom tab bar, the Save bar and the keyboard together left almost
// nothing of the field). This marks <html> with `typing-focus` while a text
// field, text area or editor has focus; the stylesheets act on it at phone
// width only (BottomBar.css hides the bar, AdminSettings.css folds the Save
// bar to one line). Mounted once, in App.tsx.

import { useEffect } from "react";

export const TYPING_FOCUS_CLASS = "typing-focus";

/** Fields that bring up a keyboard; not checkboxes, radios, buttons, sliders or pickers. */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NOT_TYPED.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useTypingFocus(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle(TYPING_FOCUS_CLASS, isTypingTarget(document.activeElement));
    // focusout fires before the next field's focusin; read where focus landed after both.
    const later = () => window.setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
      root.classList.remove(TYPING_FOCUS_CLASS);
    };
  }, []);
}
