// Choosing a hub's jurisdiction from the reference list (20260927000000):
// state, then type, then a type-ahead over that state's jurisdictions of
// that type. "Other / not listed" takes a typed name instead (a
// neighbourhood, a tribal nation, an association) and leaves the OCD id
// empty. Used by Create hub and by a hub's Configuration.
//
// Hubs already serving the chosen jurisdiction are shown as information:
// several hubs may serve one place.

import { useEffect, useId, useRef, useState } from "react";
import { api, type Jurisdiction, type JurisdictionMatch } from "./api";
import { REFERENCE_JURISDICTION_TYPES, stateOfOcdId, type ReferenceJurisdictionType } from "../../../src/shared/jurisdictionType";

/** Where the picker reads the list: the console's API, or the start page's (session 4b). */
export interface JurisdictionSource {
  states: () => Promise<{ states: Jurisdiction[] }>;
  searchJurisdictions: (state: string, type: string, q: string) => Promise<{ matches: JurisdictionMatch[] }>;
}

export type JurisdictionChoice =
  | { kind: "listed"; row: JurisdictionMatch }
  | { kind: "custom" }
  /** No place at all: allowed for a hub that is not a place (optional mode). */
  | { kind: "none" }
  /** A hub made before the list existed, not linked yet. Only the hub page shows it. */
  | { kind: "unlinked" };

export function JurisdictionPicker({
  value,
  onChange,
  currentOcdId,
  currentName,
  hubId,
  optional = false,
  onTypeChange,
  source = api,
  plain = false,
}: {
  value: JurisdictionChoice;
  onChange: (choice: JurisdictionChoice) => void;
  /** The hub page: the id the hub has now, shown until something else is chosen. */
  currentOcdId?: string | null;
  currentName?: string | null;
  /** The hub being edited, left out of "already served by". */
  hubId?: string;
  /** A hub that is not a place: "Related place (optional)", with a None choice. */
  optional?: boolean;
  /**
   * The Type select changed. Create hub uses it as the hub's type too, so the
   * form asks for a type once (2026-10-06).
   */
  onTypeChange?: (type: ReferenceJurisdictionType | "") => void;
  /** The console's API unless given (the start page passes its own). */
  source?: JurisdictionSource;
  /** For a visitor (the start page): no OCD ids or census codes. */
  plain?: boolean;
}) {
  const [states, setStates] = useState<Jurisdiction[] | null>(null);
  const [state, setState] = useState(value.kind === "listed" ? value.row.state : (stateOfOcdId(currentOcdId) ?? ""));
  const [type, setType] = useState<string>(value.kind === "listed" ? value.row.type : "");
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<JurisdictionMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listId = useId();
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Typing over a chosen place: the search is open again until something is picked. */
  const [editing, setEditing] = useState(false);
  const chosen = value.kind === "listed" ? value.row : null;

  useEffect(() => {
    source
      .states()
      .then((r) => setStates(r.states))
      .catch((e: Error) => {
        setStates([]);
        setLoadError(e.message);
      });
  }, [source]);

  // The type-ahead, debounced; answers that arrive out of order are dropped.
  const searching =
    Boolean(state && type) && value.kind !== "custom" && value.kind !== "none" && (value.kind !== "listed" || editing);
  useEffect(() => {
    if (!searching) return;
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      source
        .searchJurisdictions(state, type, q)
        .then((r) => {
          if (n === seq.current) {
            setMatches(r.matches);
            setActive(0);
          }
        })
        .catch(() => n === seq.current && setMatches([]));
    }, 150);
    return () => window.clearTimeout(t);
  }, [state, type, q, searching, source]);

  const listLoaded = states !== null && states.length > 0;
  const shown = searching ? matches : [];
  const custom = value.kind === "custom";
  const none = value.kind === "none";

  function choose(row: JurisdictionMatch) {
    onChange({ kind: "listed", row });
    setQ("");
    setEditing(false);
    setOpen(false);
  }

  const others = value.kind === "listed" ? value.row.hubs.filter((h) => h.id !== hubId) : [];

  return (
    <div className="cx-jpick">
      <div className="cx-field" role="radiogroup" aria-label="Where the jurisdiction comes from">
        <span>{optional ? "Related place (optional)" : "Jurisdiction"}</span>
        {optional && (
          <label className="cx-radio">
            <input type="radio" name={`${listId}-source`} checked={none} onChange={() => onChange({ kind: "none" })} />
            <span>
              None
              <small className="cx-muted">No place: no jurisdiction, code or governing body.</small>
            </span>
          </label>
        )}
        <label className="cx-radio">
          <input
            type="radio"
            name={`${listId}-source`}
            checked={!custom && !none}
            disabled={!listLoaded}
            onChange={() => onChange(value.kind === "custom" || value.kind === "none" ? { kind: "unlinked" } : value)}
          />
          <span>From the list</span>
        </label>
        <label className="cx-radio">
          <input type="radio" name={`${listId}-source`} checked={custom} onChange={() => onChange({ kind: "custom" })} />
          <span>
            Other / not listed
            <small className="cx-muted">A neighbourhood, a tribal nation, an association: type its name below.{plain ? "" : " No OCD id."}</small>
          </span>
        </label>
      </div>

      {states !== null && !listLoaded && !none && (
        <p className="cx-alert cx-alert-warn">
          {loadError
            ? `The jurisdiction list could not be read: ${loadError}`
            : "The jurisdiction list is not loaded on this database (scripts/load-jurisdictions.ts)."}{" "}
          Choose Other / not listed, or load the list first.
        </p>
      )}

      {!custom && !none && listLoaded && (
        <>
          <div className="cx-two">
            <label className="cx-field">
              <span>State</span>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Choose…</option>
                {states!.map((s) => (
                  <option key={s.ocd_id} value={s.state}>
                    {s.official_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cx-field">
              <span>Type</span>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  onTypeChange?.(e.target.value as ReferenceJurisdictionType | "");
                }}
                disabled={!state}
              >
                <option value="">Choose…</option>
                {REFERENCE_JURISDICTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <small className="cx-muted cx-slug-note">
            State and type narrow the search. The type also sets the usual governing body and which sample content fits.
          </small>
          <div className="cx-field cx-combo">
            <label htmlFor={`${listId}-q`}>
              <span>Name</span>
            </label>
            <div className="cx-combo-input">
              <input
                id={`${listId}-q`}
                ref={inputRef}
                role="combobox"
                aria-expanded={open && shown.length > 0}
                aria-controls={`${listId}-list`}
                aria-autocomplete="list"
                aria-activedescendant={open && shown[active] ? `${listId}-opt-${active}` : undefined}
                autoComplete="off"
                disabled={!state || !type}
                placeholder={state && type ? "Start typing…" : "Choose a state and a type first"}
                // The chosen place sits in the field itself; typing reopens the search.
                value={chosen && !editing ? chosen.display_name : q}
                className={chosen && !editing ? "cx-combo-chosen" : undefined}
                onChange={(e) => {
                  setEditing(true);
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => {
                  if (!chosen || editing) setOpen(true);
                }}
                onBlur={() =>
                  window.setTimeout(() => {
                    setOpen(false);
                    // Left mid-edit with a place still chosen: show the place again.
                    setEditing(false);
                    setQ("");
                  }, 120)
                }
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setOpen(true);
                    setActive((a) => Math.min(a + 1, shown.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && (shown[active] || shown.length === 1)) {
                    // The highlighted match, or the only one left.
                    e.preventDefault();
                    choose(shown[active] ?? shown[0]);
                  } else if (e.key === "Escape") {
                    setOpen(false);
                  }
                }}
              />
              {chosen && (
                <button
                  type="button"
                  className="cx-combo-clear"
                  aria-label={`Clear ${chosen.display_name}`}
                  title="Clear"
                  onClick={() => {
                    onChange({ kind: "unlinked" });
                    setQ("");
                    setEditing(true);
                    setOpen(true);
                    inputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {open && shown.length > 0 && (
              <ul className="cx-listbox" role="listbox" id={`${listId}-list`}>
                {shown.map((m, i) => (
                  <li
                    key={m.ocd_id}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(m)}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span>{m.display_name}</span>
                    {m.hubs.filter((h) => h.id !== hubId).length > 0 && (
                      <span className="cx-badge">
                        {m.hubs.filter((h) => h.id !== hubId).length} hub{m.hubs.filter((h) => h.id !== hubId).length === 1 ? "" : "s"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {open && state && type && q && shown.length === 0 && (
              <small className="cx-muted">Nothing on the official list matches. Check the state and type; if the place isn't on the list (a neighbourhood, a new or informal place), choose <strong>Other / not listed</strong> above and type its name.</small>
            )}
            {chosen && plain ? (
              chosen.type === "cdp" && (
                <small className="cx-muted">
                  This is a census-designated place: it has no local government of its own; its residents are governed by
                  the surrounding county or town.
                </small>
              )
            ) : chosen ? (
              <small className="cx-muted">
                <span className="cx-mono cx-break">{chosen.ocd_id}</span> · Census: {chosen.official_name} · GEOID{" "}
                {chosen.census_geoid}
                {chosen.type === "cdp" &&
                  ". A census-designated place has no local government of its own; its residents are governed by the surrounding county or town."}
              </small>
            ) : (
              <small className="cx-muted">The place this hub serves, from the official list. Enter picks the highlighted match.</small>
            )}
          </div>
        </>
      )}

      {value.kind === "unlinked" && !custom && (currentOcdId !== undefined || currentName !== undefined) && (
        <p className="cx-muted cx-small">
          {currentOcdId ? (
            <>
              Linked to <span className="cx-mono cx-break">{currentOcdId}</span>. Choose another above to change it.
            </>
          ) : (
            <>
              Not linked to the list yet{currentName ? ` (named "${currentName}")` : ""}. Choose its jurisdiction above.
            </>
          )}
        </p>
      )}
      {others.length > 0 && (
        <p className="cx-alert cx-alert-info" role="status">
          Already served by {others.map((h) => `${h.name} (${h.id}${h.archived ? ", archived" : ""})`).join(", ")}. More than
          one hub may serve a jurisdiction.
        </p>
      )}
    </div>
  );
}
