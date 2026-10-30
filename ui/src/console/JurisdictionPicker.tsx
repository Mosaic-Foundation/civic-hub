// Choosing a hub's jurisdiction from the reference list (20260927000000):
// state, then type, then a type-ahead over that state's jurisdictions of
// that type. "Other / not listed" takes a typed name instead (a
// neighbourhood, a tribal nation, an association) and leaves the OCD id
// empty: a choice of the Neighbourhood or association kind when a hub is made
// (2026-10-30). Used by Create hub and by a hub's Configuration, which still
// offers every choice, for the hubs that already have one.
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
  noneChoice = optional,
  customChoice = true,
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
  /** Offer None. With no None and no Other, the picker is the list alone. */
  noneChoice?: boolean;
  /** Offer Other / not listed. */
  customChoice?: boolean;
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
  const blurTimer = useRef<number | undefined>(undefined);
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
  const searching = Boolean(state && type) && value.kind === "unlinked";
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
    setOpen(false);
  }

  /** The pick no longer stands: its state or type changed, it was cleared, or it is being typed over. */
  function release(nextQ = "") {
    if (chosen) onChange({ kind: "unlinked" });
    setQ(nextQ);
  }

  /** What is left to search for once typing replaces the pick: only what was typed, not the place's own name. */
  function typedOver(typed: string, name: string): string {
    if (typed.startsWith(name)) return typed.slice(name.length);
    if (typed.length === name.length - 1 && name.startsWith(typed)) return "";
    return typed;
  }

  const others = value.kind === "listed" ? value.row.hubs.filter((h) => h.id !== hubId) : [];

  return (
    <div className="cx-jpick">
      {(noneChoice || customChoice) && (
      <div className="cx-field" role="radiogroup" aria-label="Where the jurisdiction comes from">
        {/* On the start page the form's own heading says this. */}
        {!plain && <span>{optional ? "Location (optional)" : "Jurisdiction"}</span>}
        {noneChoice && (
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
          <span>
            From the list
            <small className="cx-muted">An official jurisdiction: a state, county, city, town or school district.</small>
          </span>
        </label>
        {customChoice && (
          <label className="cx-radio">
            <input type="radio" name={`${listId}-source`} checked={custom} onChange={() => onChange({ kind: "custom" })} />
            <span>
              Other / not listed
              <small className="cx-muted">A neighbourhood, a tribal nation, an association: type its name below.{plain ? "" : " No OCD id."}</small>
            </span>
          </label>
        )}
      </div>
      )}

      {states !== null && !listLoaded && !none && (
        <p className="cx-alert cx-alert-warn">
          {loadError
            ? `The jurisdiction list could not be read: ${loadError}`
            : "The jurisdiction list is not loaded on this database (scripts/load-jurisdictions.ts)."}{" "}
          {customChoice ? "Choose Other / not listed, or load the list first." : "Load the list first."}
        </p>
      )}

      {!custom && !none && listLoaded && (
        <>
          <div className="cx-two">
            <label className="cx-field">
              <span>State</span>
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  release();
                }}
              >
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
                  release();
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
                // The chosen place sits in the field itself; typing replaces it and reopens the search.
                value={chosen ? chosen.display_name : q}
                className={chosen ? "cx-combo-chosen" : undefined}
                onChange={(e) => {
                  if (chosen) release(typedOver(e.target.value, chosen.display_name));
                  else setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => {
                  window.clearTimeout(blurTimer.current);
                  if (!chosen) setOpen(true);
                }}
                onClick={(e) => {
                  if (chosen) e.currentTarget.select();
                }}
                onBlur={() => {
                  blurTimer.current = window.setTimeout(() => {
                    setOpen(false);
                    setQ("");
                  }, 120);
                }}
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
                  onClick={() => {
                    release();
                    setOpen(true);
                    inputRef.current?.focus();
                  }}
                >
                  Clear
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
              <small className="cx-muted">Nothing on the official list matches. Check the state and type.{customChoice && <> If the place isn't on the list, choose <strong>Other / not listed</strong> above and type its name.</>}</small>
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
              <small className="cx-muted">{optional ? "Where this hub is" : "The place this hub serves"}, from the official list. Enter picks the highlighted match.</small>
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
