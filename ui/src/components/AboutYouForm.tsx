import { useEffect, useId, useRef, useState } from "react";
import { Button, Checkbox, Select } from "../kit";
import { lookUpDistrict, suggestAddresses } from "../services/aboutYou";
import { useHub } from "../config/hub";
import type { AboutFormState } from "./aboutYouState";
import {
  BIRTH_YEAR_MIN,
  MIN_AGE,
  RACE_OPTIONS,
  type AboutConfig,
} from "../../../src/shared/aboutYou";
import "./AboutYouForm.css";

/**
 * The About-you questions (districts and demographics, 2026-11-16), as the
 * one-time card and Settings > About you both show them. Only the questions
 * the hub asks; each can be left empty or answered "Prefer not to say".
 */

const PREFER_NOT = "prefer_not";

/** Suggestions: asked from this many characters, after this long a pause in typing. */
const SUGGEST_MIN_CHARS = 3;
const SUGGEST_PAUSE_MS = 300;

export default function AboutYouForm({
  config,
  state,
  onChange,
  disabled = false,
}: {
  config: AboutConfig;
  state: AboutFormState;
  onChange: (next: AboutFormState) => void;
  disabled?: boolean;
}) {
  const ids = { district: useId(), year: useId(), race: useId() };
  const latestYear = new Date().getFullYear() - MIN_AGE;
  const term = config.term.singular;

  return (
    <div className="about-form">
      {config.questions.district && (
        <div className="about-form-question">
          <label className="form-label" htmlFor={ids.district}>
            Your {term.toLowerCase()}
          </label>
          <Select
            id={ids.district}
            value={state.district}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, district: e.target.value })}
          >
            <option value="">Not answered</option>
            {config.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={PREFER_NOT}>Prefer not to say</option>
          </Select>
          <AddressLookup
            config={config}
            disabled={disabled}
            onFound={(id) => onChange({ ...state, district: id })}
          />
        </div>
      )}

      {config.questions.birth_year && (
        <div className="about-form-question">
          <label className="form-label" htmlFor={ids.year}>
            Year of birth
          </label>
          <span className="about-form-row">
            <input
              id={ids.year}
              className="form-input about-form-year"
              type="number"
              inputMode="numeric"
              min={BIRTH_YEAR_MIN}
              max={latestYear}
              placeholder="e.g. 1975"
              value={state.birthYear === PREFER_NOT ? "" : state.birthYear}
              disabled={disabled || state.birthYear === PREFER_NOT}
              onChange={(e) => onChange({ ...state, birthYear: e.target.value })}
            />
            <Checkbox
              label="Prefer not to say"
              checked={state.birthYear === PREFER_NOT}
              disabled={disabled}
              onChange={(e) => onChange({ ...state, birthYear: e.target.checked ? PREFER_NOT : "" })}
            />
          </span>
          <p className="form-hint">Results only show age groups, never a year.</p>
        </div>
      )}

      {config.questions.race && (
        <fieldset className="about-form-question about-form-fieldset" aria-describedby={ids.race}>
          <legend className="form-label">Race or ethnicity</legend>
          <p className="form-hint" id={ids.race}>
            Choose any that apply.
          </p>
          {RACE_OPTIONS.map((r) => (
            <Checkbox
              key={r.id}
              label={r.label}
              checked={!state.racePreferNot && state.race.includes(r.id)}
              disabled={disabled || state.racePreferNot}
              onChange={(e) =>
                onChange({
                  ...state,
                  race: e.target.checked ? [...state.race, r.id] : state.race.filter((x) => x !== r.id),
                })
              }
            />
          ))}
          <Checkbox
            label="Prefer not to say"
            checked={state.racePreferNot}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, racePreferNot: e.target.checked })}
          />
        </fieldset>
      )}
    </div>
  );
}

/** Why the lookup found no district; a found address with no match just asks the member to choose. */
const LOOKUP_REASON: Record<"not_found" | "no_match" | "unavailable", string> = {
  not_found: "We couldn't find that address.",
  no_match: "",
  unavailable: "The lookup isn't working right now.",
};

/**
 * "Not sure? Find it by address". Where the hub has Mapbox set up, up to five
 * addresses are suggested as the member types (after a pause, from three
 * characters); picking one finds its district at once. Otherwise, or if
 * suggestions fail, they type the whole address and press Find. The address
 * goes to the hub, which passes it on (to Mapbox for suggestions, to the
 * Census Bureau for the district) and keeps it nowhere.
 */
function AddressLookup({
  config,
  disabled,
  onFound,
}: {
  config: AboutConfig;
  disabled: boolean;
  onFound: (districtId: string) => void;
}) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const hub = useHub();
  const [suggesting, setSuggesting] = useState(() => hub.config?.address_suggestions === true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  // Typed, not picked: only typing asks for suggestions.
  const typed = useRef(false);
  const term = config.term.singular.toLowerCase();

  useEffect(() => {
    if (!suggesting || !typed.current) return;
    const text = address.trim();
    if (text.length < SUGGEST_MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      suggestAddresses(text)
        .then((r) => {
          if (!current) return;
          if (!r.available) setSuggesting(false);
          setSuggestions(r.suggestions);
          setActive(-1);
        })
        .catch(() => {
          if (current) setSuggestions([]);
        });
    }, SUGGEST_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [address, suggesting]);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="about-form-lookup-open" onClick={() => setOpen(true)} disabled={disabled}>
        Not sure? Find it by address
      </Button>
    );
  }

  async function find(value: string = address) {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    setSuggestions([]);
    try {
      const r = await lookUpDistrict(value);
      if (r.match) {
        onFound(r.match.id);
        setMessage(`That address is in ${r.match.name}. We've chosen it above; change it if that's wrong.`);
        typed.current = false;
        setAddress("");
      } else {
        setFailed(true);
        setMessage(`${LOOKUP_REASON[r.reason ?? "unavailable"]} Choose your ${term} from the list.`.trim());
      }
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : "The lookup isn't working right now.");
    } finally {
      setBusy(false);
    }
  }

  function pick(value: string) {
    typed.current = false;
    setAddress(value);
    void find(value);
  }

  const showList = suggestions.length > 0 && !busy;

  return (
    <div className="about-form-lookup">
      <label className="form-label" htmlFor={id}>
        Your street address
      </label>
      <span className="about-form-row">
        <input
          id={id}
          className="form-input"
          type="text"
          autoComplete="street-address"
          role={suggesting ? "combobox" : undefined}
          aria-autocomplete={suggesting ? "list" : undefined}
          aria-expanded={suggesting ? showList : undefined}
          aria-controls={suggesting ? listId : undefined}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={address}
          maxLength={200}
          disabled={disabled || busy}
          onChange={(e) => {
            typed.current = true;
            setAddress(e.target.value);
          }}
          onKeyDown={(e) => {
            if (showList && e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (showList && e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, -1));
            } else if (showList && e.key === "Escape") {
              setSuggestions([]);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList && active >= 0) pick(suggestions[active]!);
              else if (address.trim().length >= 5) void find();
            }
          }}
          placeholder={suggesting ? "Start typing your address" : "Street, town, ZIP"}
        />
        <Button size="sm" onClick={() => void find()} disabled={disabled || busy || address.trim().length < 5}>
          {busy ? "Looking…" : "Find"}
        </Button>
      </span>
      {showList && (
        <ul className="about-form-suggestions" id={listId} role="listbox" aria-label="Suggested addresses">
          {suggestions.map((s, i) => (
            <li key={s} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`about-form-suggestion${i === active ? " is-active" : ""}`}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="form-hint">
        {suggesting
          ? `Your address is sent to Mapbox to suggest matches and to the US Census Bureau to find your ${term}. We don't keep it.`
          : `Your address is sent once to the US Census Bureau to find your ${term}. We don't keep it.`}
      </p>
      {message && (
        <p className={failed ? "form-error" : "settings-message"} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
