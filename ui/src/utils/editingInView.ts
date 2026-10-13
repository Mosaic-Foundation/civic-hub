/**
 * Phone drafting (Submit and Save): the field being typed in, if it is still
 * on screen. The pinned bar steps aside and the formatting toolbar docks only
 * while this is true; scroll the field away, cursor still in it, and the bar
 * is back and the toolbar gone (Adam, 2026-10-13: they overlapped, and Submit
 * couldn't be reached).
 */

/** A field the keyboard opens for (not a checkbox, button or select). */
export const TYPING_FIELDS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]';

/** Is this element on screen, in the visible part above the keyboard? */
export function onScreen(el: Element, margin = 48): boolean {
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const bottom = top + (vv ? vv.height : window.innerHeight);
  return r.bottom > top + margin && r.top < bottom - margin;
}

/** The drafting form's focused text field, when it is on screen; else null. */
export function editingInView(): Element | null {
  const el = document.activeElement;
  if (!el?.matches?.(TYPING_FIELDS) || !el.closest(".drafting-form")) return null;
  return onScreen(el) ? el : null;
}

/** How long the page must be still before the bar and toolbar settle. */
export const SETTLE_MS = 150;
