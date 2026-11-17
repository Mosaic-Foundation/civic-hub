// Districts — what the hub calls its districts, the list members choose
// from, and which About-you questions are asked
// (districts and demographics, Adam 2026-11-16; src/shared/aboutYou.ts).

import { useEffect, useId, useRef, useState } from "react";
import { adminCensusDistricts } from "../../services/api";
import HelpButton from "../../components/HelpButton";
import SectionForm, { type FormApi } from "./SectionForm";
import { BooleanField, TextField } from "./fields";
import { Button } from "../../kit";
import {
  ABOUT_KEYS,
  DISTRICTS_MAX,
  DISTRICT_NAME_MAX,
  DEFAULT_DISTRICT_TERM,
  districtIdFrom,
  parseDistricts,
  pluralOf,
  type District,
} from "../../../../src/shared/aboutYou";

export default function DistrictsSection() {
  const fallback = DEFAULT_DISTRICT_TERM;
  return (
    <SectionForm
      section="districts"
      title="Districts"
      intro={
        <p className="form-hint">
          Members can tell the hub which district they live in and their year of birth, so results can show totals for
          each. Each member sees only their own answers, and results hide any group of fewer than 5 people.
        </p>
      }
    >
      {(f) => {
        const singular = f.value(ABOUT_KEYS.DISTRICT_TERM).trim() || fallback.singular;
        return (
          <>
            <TextField
              f={f}
              k={ABOUT_KEYS.DISTRICT_TERM}
              label="What a district is called"
              placeholder={fallback.singular}
              hint={`However your area is divided, for example district, ward, precinct or borough. Leave it empty to use ${fallback.singular}.`}
              width={280}
            />
            <TextField
              f={f}
              k={ABOUT_KEYS.DISTRICT_TERM_PLURAL}
              label="More than one"
              placeholder={f.value(ABOUT_KEYS.DISTRICT_TERM).trim() ? pluralOf(singular) : fallback.plural}
              width={280}
            />
            <DistrictListField f={f} singular={singular} />
            <h3 className="settings-subsection-title" style={{ marginTop: "var(--space-6)" }}>
              Questions members are asked
            </h3>
            <p className="form-hint">
              Asked once, the first time a member takes part in something. Every question can be skipped or answered
              "Prefer not to say".
            </p>
            <BooleanField
              f={f}
              k={ABOUT_KEYS.ASK_DISTRICT}
              label={`Which ${singular.toLowerCase()} they live in`}
              hint="Needs at least one district in the list above."
            />
            <BooleanField f={f} k={ABOUT_KEYS.ASK_BIRTH_YEAR} label="Year of birth" hint="Results show age groups, never a year." />
            <BooleanField
              f={f}
              k={ABOUT_KEYS.ASK_RACE}
              label="Race or ethnicity"
              hint="Off unless you switch it on. Results show totals only."
            />
          </>
        );
      }}
    </SectionForm>
  );
}

/** The districts, as a list of names. Each keeps its id when renamed, so past results keep it. */
function DistrictListField({ f, singular }: { f: FormApi; singular: string }) {
  const id = useId();
  const list = parseDistricts(f.value(ABOUT_KEYS.DISTRICTS));
  const [draft, setDraft] = useState("");
  const save = (next: District[]) => f.set(ABOUT_KEYS.DISTRICTS, next.length ? JSON.stringify(next) : "");
  // The county's subdivisions from the Census (Adam, 2026-11-16: nobody should
  // have to upload a map). An empty list is filled from it once, on opening;
  // the admin checks the names and saves.
  const [census, setCensus] = useState<District[] | null>(null);
  const [filled, setFilled] = useState(false);
  const tried = useRef(false);
  const empty = list.length === 0;
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    adminCensusDistricts()
      .then((r) => {
        if (!r.districts?.length) return;
        setCensus(r.districts);
        if (empty) {
          f.set(ABOUT_KEYS.DISTRICTS, JSON.stringify(r.districts));
          setFilled(true);
        }
      })
      .catch(() => undefined);
  }, [empty, f]);
  const add = () => {
    const name = draft.trim();
    if (!name || list.length >= DISTRICTS_MAX) return;
    if (list.some((d) => d.name.toLowerCase() === name.toLowerCase())) return;
    save([...list, { id: districtIdFrom(name, list.map((d) => d.id)), name }]);
    setDraft("");
  };
  return (
    <div className="settings-field" id="about-districts">
      <div className="settings-field-label-row">
        <label className="form-label settings-field-label" htmlFor={id}>
          Districts
        </label>
        <HelpButton k={ABOUT_KEYS.DISTRICTS} label="Districts" />
      </div>
      <p className="form-hint">
        The {singular.toLowerCase()} names members choose from. Renaming one keeps it the same in past results.
      </p>
      {filled && (
        <p className="settings-message" role="status">
          Filled in from the US Census for your county. Check the names, then save.
        </p>
      )}
      {list.length > 0 && (
        <ul className="settings-district-list" style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-2)" }}>
          {list.map((d, i) => (
            <li key={d.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginBottom: "var(--space-1)" }}>
              <input
                className="form-input"
                type="text"
                aria-label={`Name of ${d.name}`}
                value={d.name}
                maxLength={DISTRICT_NAME_MAX}
                disabled={f.disabled}
                onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                style={{ maxWidth: "36ch" }}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={f.disabled}
                onClick={() => save(list.filter((_, j) => j !== i))}
                aria-label={`Remove ${d.name}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <input
          id={id}
          className="form-input"
          type="text"
          value={draft}
          maxLength={DISTRICT_NAME_MAX}
          placeholder={`Add a ${singular.toLowerCase()}`}
          disabled={f.disabled || list.length >= DISTRICTS_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          style={{ maxWidth: "36ch" }}
        />
        <Button size="sm" disabled={f.disabled || !draft.trim()} onClick={add}>
          Add
        </Button>
        {census && !filled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={f.disabled}
            onClick={() => {
              save(census);
              setFilled(true);
            }}
          >
            Use the Census list
          </Button>
        )}
      </span>
    </div>
  );
}
