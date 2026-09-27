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
import { REFERENCE_JURISDICTION_TYPES, stateOfOcdId } from "../../../src/shared/jurisdictionType";

export type JurisdictionChoice =
  | { kind: "listed"; row: JurisdictionMatch }
  | { kind: "custom" }
  /** A hub made before the list existed, not linked yet. Only the hub page shows it. */
  | { kind: "unlinked" };

export function JurisdictionPicker({
  value,
  onChange,
  currentOcdId,
  currentName,
  hubId,
}: {
  value: JurisdictionChoice;
  onChange: (choice: JurisdictionChoice) => void;
  /** The hub page: the id the hub has now, shown until something else is chosen. */
  currentOcdId?: string | null;
  currentName?: string | null;
  /** The hub being edited, left out of "already served by". */
  hubId?: string;
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

  useEffect(() => {
    api
      .states()
      .then((r) => setStates(r.states))
      .catch((e: Error) => {
        setStates([]);
        setLoadError(e.message);
      });
  }, []);

  // The type-ahead, debounced; answers that arrive out of order are dropped.
  const searching = Boolean(state && type) && value.kind !== "custom";
  useEffect(() => {
    if (!searching) return;
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api
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
  }, [state, type, q, searching]);

  const listLoaded = states !== null && states.length > 0;
  const shown = searching ? matches : [];
  const custom = value.kind === "custom";

  function choose(row: JurisdictionMatch) {
    onChange({ kind: "listed", row });
    setQ("");
    setOpen(false);
  }

  const others = value.kind === "listed" ? value.row.hubs.filter((h) => h.id !== hubId) : [];

  return (
    <div className="cx-jpick">
      <div className="cx-field" role="radiogroup" aria-label="Where the jurisdiction comes from">
        <span>Jurisdiction</span>
        <label className="cx-radio">
          <input
            type="radio"
            name={`${listId}-source`}
            checked={!custom}
            disabled={!listLoaded}
            onChange={() => onChange(value.kind === "custom" ? { kind: "unlinked" } : value)}
          />
          <span>From the list</span>
        </label>
        <label className="cx-radio">
          <input type="radio" name={`${listId}-source`} checked={custom} onChange={() => onChange({ kind: "custom" })} />
          <span>
            Other / not listed
            <small className="cx-muted">A neighbourhood, a tribal nation, an association: type its name below. No OCD id.</small>
          </span>
        </label>
      </div>

      {states !== null && !listLoaded && (
        <p className="cx-alert cx-alert-warn">
          {loadError
            ? `The jurisdiction list could not be read: ${loadError}`
            : "The jurisdiction list is not loaded on this database (scripts/load-jurisdictions.ts)."}{" "}
          Choose Other / not listed, or load the list first.
        </p>
      )}

      {!custom && listLoaded && (
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
              <select value={type} onChange={(e) => setType(e.target.value)} disabled={!state}>
                <option value="">Choose…</option>
                {REFERENCE_JURISDICTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="cx-field cx-combo">
            <label htmlFor={`${listId}-q`}>
              <span>Name</span>
            </label>
            <input
              id={`${listId}-q`}
              role="combobox"
              aria-expanded={open && shown.length > 0}
              aria-controls={`${listId}-list`}
              aria-autocomplete="list"
              aria-activedescendant={open && shown[active] ? `${listId}-opt-${active}` : undefined}
              autoComplete="off"
              disabled={!state || !type}
              placeholder={state && type ? "Start typing…" : "Choose a state and a type first"}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setOpen(true);
                  setActive((a) => Math.min(a + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && open && shown[active]) {
                  e.preventDefault();
                  choose(shown[active]);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
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
              <small className="cx-muted">Nothing matches. Check the type, or choose Other / not listed.</small>
            )}
          </div>
        </>
      )}

      {value.kind === "listed" && (
        <div className="cx-chosen">
          <strong>{value.row.display_name}</strong>
          <span className="cx-mono cx-small cx-break">{value.row.ocd_id}</span>
          <span className="cx-muted cx-small">
            Census: {value.row.official_name} · GEOID {value.row.census_geoid}
          </span>
          {value.row.type === "cdp" && (
            <span className="cx-muted cx-small">
              A census-designated place has no local government of its own; its residents are governed by the county
              around it.
            </span>
          )}
        </div>
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
