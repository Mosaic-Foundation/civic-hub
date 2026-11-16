// Districts — what the hub calls its districts, the list members choose
// from, where to look one up, and which About-you questions are asked
// (districts and demographics, Adam 2026-11-16; src/shared/aboutYou.ts).

import { useId, useState } from "react";
import HelpButton from "../../components/HelpButton";
import SectionForm, { type FormApi } from "./SectionForm";
import { BooleanField, TextField, UrlField } from "./fields";
import { Button } from "../../kit";
import { setting } from "../../config/hubConfig";
import {
  ABOUT_KEYS,
  DISTRICTS_MAX,
  DISTRICT_NAME_MAX,
  defaultDistrictTerm,
  districtIdFrom,
  parseDistricts,
  pluralOf,
  type District,
} from "../../../../src/shared/aboutYou";

export default function DistrictsSection() {
  const fallback = defaultDistrictTerm(setting("identity.jurisdiction_type"));
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
              hint={`Used on the member card and in results, as in "Results by ${singular}". Left empty: ${fallback.singular}.`}
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
            <UrlField
              f={f}
              k={ABOUT_KEYS.FIND_DISTRICT_URL}
              label="Find your district link (optional)"
              hint="A page where people can look up their district, such as an official map. Shown when the address lookup finds no match."
            />
            <h3 className="settings-subsection-title">Questions members are asked</h3>
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
      </span>
    </div>
  );
}
