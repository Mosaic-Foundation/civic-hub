import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./SearchBar.css";

/**
 * Slice 10.5 — search affordance for the nav.
 *
 * Two modes:
 *   - inline (desktop): icon-only collapsed; expands on click; submit
 *     navigates to /search and collapses; ESC closes; the input
 *     auto-focuses on expand.
 *   - inDrawer (mobile): always rendered as a full-width input inside
 *     the hamburger drawer.
 *
 * The "/" keyboard shortcut focuses the input from anywhere on the
 * page, but only when the user isn't already typing into something
 * else (text input, textarea, contenteditable).
 *
 * Initial query is pulled from the URL when the user lands on
 * /search — the bar reflects what the page is showing.
 */

interface Props {
  /** When `true`, renders as a full-width input (mobile drawer). */
  inDrawer?: boolean;
  /** Called after the user submits — Nav uses it to close the drawer. */
  onSubmitted?: () => void;
  /** Pre-fill (e.g. when arriving on /search?q=…). */
  initialValue?: string;
}

export default function SearchBar({
  inDrawer = false,
  onSubmitted,
  initialValue = "",
}: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [expanded, setExpanded] = useState(inDrawer);
  const [value, setValue] = useState(initialValue);

  // Keep the bar's value in sync with the URL when the parent provides
  // a fresh initialValue (e.g. user pastes a /search URL while bar is
  // mounted).
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  // "/" keyboard shortcut. Skip when the user is already typing into
  // a text input / textarea / contenteditable — common UX rule.
  useEffect(() => {
    function isTextTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName.toLowerCase();
      if (tag === "input") {
        const type = (t as HTMLInputElement).type.toLowerCase();
        // Only typing-style inputs count as "already focused on text".
        return [
          "text",
          "search",
          "email",
          "password",
          "url",
          "tel",
          "number",
        ].includes(type);
      }
      if (tag === "textarea") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      setExpanded(true);
      // Defer focus to next frame so the input has actually mounted /
      // expanded before we try to focus it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Click-outside collapses the inline bar (drawer mode never collapses
  // — it's always rendered). Skip when the input has text the user
  // might still want to submit.
  useEffect(() => {
    if (!expanded || inDrawer) return;
    function onPointer(e: MouseEvent) {
      if (!formRef.current?.contains(e.target as Node)) {
        if (value.trim().length === 0) setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [expanded, inDrawer, value]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      // Empty submit on a fresh focus = navigate to /search shell so
      // the user gets the "search every post" landing.
      navigate("/search");
    } else {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }
    if (!inDrawer) setExpanded(false);
    onSubmitted?.();
  }

  function handleIconClick() {
    if (!expanded) {
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    // Already expanded — second click submits.
    formRef.current?.requestSubmit();
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!inDrawer) setExpanded(false);
      setValue("");
    }
  }

  const cls = [
    "search-bar",
    inDrawer ? "search-bar--drawer" : "search-bar--inline",
    expanded ? "is-expanded" : "is-collapsed",
  ].join(" ");

  return (
    <form
      ref={formRef}
      className={cls}
      onSubmit={handleSubmit}
      role="search"
      aria-label="Search the Civic Hub"
    >
      <button
        type="button"
        className="search-bar-icon"
        onClick={handleIconClick}
        aria-label={expanded ? "Submit search" : "Open search"}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
          <line
            x1="13.5"
            y1="13.5"
            x2="17.5"
            y2="17.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <input
        ref={inputRef}
        type="search"
        className="search-bar-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleInputKey}
        placeholder="Search the Civic Hub"
        aria-label="Search the Civic Hub"
        // When collapsed on desktop, the input is visually hidden but
        // remains in the DOM so the form submission and "/" focus
        // shortcut still work without re-mounting.
        tabIndex={expanded ? 0 : -1}
      />
    </form>
  );
}
