// The search box at the top of Hub settings (settings search, 2026-11-10).
// Type a word ("wait list", "logo", "turn off votes") and pick a result: the
// page goes to that setting's section, opens its panel, scrolls to it and
// marks it for a moment (useScrollToHash).
//
// What it finds, and every result's link, come from
// src/shared/settingsSearch.ts, built on the help registry every setting
// already joins; nothing here lists settings.
//
// A combobox (ARIA 1.2): arrows move through the results, Enter goes,
// Escape clears.

import { useId, useMemo, useState } from "react";
import { buildSearchIndex, prepareIndex, searchSettings, type SearchEntry } from "../../../../src/shared/settingsSearch";

let prepared: ReturnType<typeof prepareIndex> | null = null;
function index() {
  prepared ??= prepareIndex(buildSearchIndex());
  return prepared;
}

export default function SettingsSearch({ onGo }: { onGo: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const results = useMemo(() => searchSettings(query, index()), [query]);
  const showing = open && query.trim() !== "";

  function go(entry: SearchEntry) {
    setOpen(false);
    setQuery("");
    onGo(entry.path);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[active];
      if (showing && picked) go(picked);
    } else if (e.key === "Escape") {
      if (query) e.preventDefault();
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="settings-search" role="search">
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Search settings
      </label>
      <svg className="settings-search-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        id={`${listId}-input`}
        className="form-input settings-search-input"
        type="search"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && results[active] ? optionId(active) : undefined}
        placeholder="Search settings, e.g. logo, wait list, time zone"
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // After a click on a result has landed.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showing && (
        <div className="settings-search-panel">
          {results.length === 0 ? (
            <p className="settings-search-empty" role="status">
              No setting matches &ldquo;{query.trim()}&rdquo;. Try another word.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Settings found" className="settings-search-results">
              {results.map((r, i) => (
                <li
                  key={r.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`settings-search-result${i === active ? " is-active" : ""}`}
                  // mousedown, not click: before the input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="settings-search-label">{r.label}</span>
                  <span className="settings-search-where">{r.where}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
