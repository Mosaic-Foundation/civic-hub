import { useId, useState } from "react";
import { Button, Checkbox, Select } from "../kit";
import { lookUpDistrict } from "../services/aboutYou";
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

const LOOKUP_REASON: Record<"not_found" | "no_match" | "unavailable", string> = {
  not_found: "We couldn't find that address.",
  no_match: "We found the address but couldn't tell which one it's in.",
  unavailable: "The lookup isn't working right now.",
};

/** "Don't know? Look it up by address": the address goes to the server once, to the Census Bureau once, and is kept by neither. */
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
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const term = config.term.singular.toLowerCase();

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="about-form-lookup-open" onClick={() => setOpen(true)} disabled={disabled}>
        Not sure? Find it by address
      </Button>
    );
  }

  async function find() {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const r = await lookUpDistrict(address);
      if (r.match) {
        onFound(r.match.id);
        setMessage(`That address is in ${r.match.name}. We've chosen it above; change it if that's wrong.`);
        setAddress("");
      } else {
        setFailed(true);
        setMessage(`${LOOKUP_REASON[r.reason ?? "unavailable"]} Choose your ${term} from the list.`);
      }
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : "The lookup isn't working right now.");
    } finally {
      setBusy(false);
    }
  }

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
          value={address}
          maxLength={200}
          disabled={disabled || busy}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (address.trim().length >= 5) void find();
            }
          }}
          placeholder="Street, town, ZIP"
        />
        <Button size="sm" onClick={() => void find()} disabled={disabled || busy || address.trim().length < 5}>
          {busy ? "Looking…" : "Find"}
        </Button>
      </span>
      <p className="form-hint">
        Your address is sent once to the US Census Bureau to find your {term}. We don't keep it.
      </p>
      {message && (
        <p className={failed ? "form-error" : "settings-message"} role="status">
          {message}
          {failed && config.findDistrictUrl && (
            <>
              {" "}
              <a href={config.findDistrictUrl} target="_blank" rel="noopener noreferrer">
                Find your {term}
              </a>
            </>
          )}
        </p>
      )}
      {!message && config.findDistrictUrl && (
        <p className="form-hint">
          <a href={config.findDistrictUrl} target="_blank" rel="noopener noreferrer">
            Find your {term} on a map
          </a>
        </p>
      )}
    </div>
  );
}
