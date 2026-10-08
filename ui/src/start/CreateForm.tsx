// The start page's create form (session 4b): a shorter version of the
// console's Create hub. Kind, place, governing body and board label, hub
// name, web address, time zone, and who runs it (operator and contact
// address; Adam, 2026-10-08). What a visitor may not choose is fixed on the
// server: demo mode, the address under this page's domain, them as the first
// admin, sample content on, every plugin on.
//
// Suggestions work as on the console: grey text in an empty field is used
// as it is unless typed over (../console/SuggestInput.tsx). The page says so
// once, at the top, rather than under every field as the console does.

import { useEffect, useMemo, useRef, useState } from "react";
import { StartApiError, startApi, startJurisdictions, type StartConfig } from "./api";
import type { SlugSuggestion } from "../console/api";
import { JurisdictionPicker, type JurisdictionChoice } from "../console/JurisdictionPicker";
import { SuggestInput } from "../console/SuggestInput";
import {
  JURISDICTION_TYPES,
  defaultGoverningBody,
  defaultGoverningBodyShort,
  hubTypeFor,
  isJurisdictionType,
  type ReferenceJurisdictionType,
} from "../../../src/shared/jurisdictionType";
import { defaultHubName, jurisdictionCodeFor } from "../../../src/shared/jurisdictionNames";
import { HUB_KINDS, type HubKind } from "../../../src/shared/hubKind";
import { SPLIT_STATES, suggestedTimeZone } from "../../../src/shared/stateTimeZones";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

/** The browser's own zone, a fair guess for a hub that is not a place. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

export default function CreateForm({
  email,
  onSessionEnded,
  onLeave,
}: {
  email: string;
  onSessionEnded: () => void;
  onLeave: () => void;
}) {
  const [config, setConfig] = useState<StartConfig | null>(null);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    jurisdiction_name: "",
    jurisdiction_type: "",
    governing_body: "",
    governing_body_short: "",
    timezone: "",
    operator_name: "",
    contact_email: "",
  });
  const [choice, setChoice] = useState<JurisdictionChoice>({ kind: "unlinked" });
  const [hubKind, setHubKind] = useState<HubKind>("place");
  const [pickerType, setPickerType] = useState<ReferenceJurisdictionType | "">("");
  const [suggestion, setSuggestion] = useState<SlugSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const isPlace = hubKind === "place";

  useEffect(() => {
    startApi
      .config()
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --- Suggestions: what the chosen place implies (as on the console) ---

  const listed = choice.kind === "listed" ? choice.row : null;
  const suggestedPlaceName = listed?.display_name ?? "";
  const placeName = form.jurisdiction_name || suggestedPlaceName;
  const placeCode = listed ? (jurisdictionCodeFor(listed) ?? "") : "";
  const hubType = !isPlace
    ? ""
    : listed
      ? hubTypeFor(listed.type)
      : choice.kind === "custom"
        ? form.jurisdiction_type
        : pickerType
          ? hubTypeFor(pickerType)
          : "";
  const suggest = {
    name: isPlace && placeName ? defaultHubName(placeName) : "",
    governing_body:
      isPlace && isJurisdictionType(hubType) ? defaultGoverningBody(hubType, placeCode, listed?.ocd_id ?? null) : "",
    timezone: isPlace && listed ? suggestedTimeZone(listed.state) : browserTimeZone(),
  };
  const governingBody = isPlace ? form.governing_body || suggest.governing_body : "";
  const suggestShort = governingBody ? defaultGoverningBodyShort(governingBody) : "";
  const governingBodyShort = governingBody ? form.governing_body_short || suggestShort : "";
  const name = form.name || suggest.name;
  const timezone = form.timezone || suggest.timezone;

  const slugSource = useMemo(() => {
    if (listed) return { name: listed.official_name, type: listed.type, state: listed.state };
    if (choice.kind === "custom" && placeName) return { name: placeName, type: null, state: null };
    const bare = name.replace(/civic hub/gi, "").trim();
    return bare ? { name: bare, type: null, state: null } : null;
  }, [listed, choice.kind, placeName, name]);

  useEffect(() => {
    const n = ++seq.current;
    if (!slugSource) {
      const clear = window.setTimeout(() => n === seq.current && setSuggestion(null), 0);
      return () => window.clearTimeout(clear);
    }
    const t = window.setTimeout(() => {
      startApi
        .suggestSlug(slugSource.name, slugSource.type, slugSource.state)
        .then((s) => {
          if (n === seq.current) setSuggestion(s);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [slugSource]);

  const suggestedSlug = suggestion?.slug ?? "";
  const slug = form.slug || suggestedSlug;
  const domain = config?.hub_domain ?? "";
  const slugProblem =
    slug && !SLUG_RE.test(slug) ? "2–32 characters: lowercase letters, digits and hyphens, not at either end." : null;

  const placeReady =
    choice.kind === "listed" ||
    (choice.kind === "custom" && placeName.trim() !== "") ||
    (!isPlace && (choice.kind === "none" || choice.kind === "unlinked"));
  const ready = Boolean(name && slug && domain && !slugProblem && placeReady);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const hasPlace = choice.kind === "listed" || choice.kind === "custom";
      const created = await startApi.createHub({
        name,
        slug,
        hub_kind: hubKind,
        jurisdiction_name: hasPlace ? placeName : "",
        jurisdiction_type: isPlace ? hubType : "",
        jurisdiction_ocd_id: listed ? listed.ocd_id : null,
        jurisdiction_custom: choice.kind === "custom",
        governing_body: governingBody,
        governing_body_short: governingBodyShort,
        timezone,
        operator_name: form.operator_name || name,
        contact_email: form.contact_email || email,
      });
      // Off to the hub, signed in. Kept busy: the page is leaving.
      window.location.assign(created.redirect);
    } catch (err) {
      setBusy(false);
      if (err instanceof StartApiError && (err.status === 401 || err.status === 403)) {
        window.alert((err as Error).message);
        onSessionEnded();
        return;
      }
      setError((err as Error).message);
    }
  }

  return (
    <main className="st-page">
      <header className="st-head">
        <p className="cx-eyebrow">Civic Social</p>
        <h1 className="cx-title">Create your hub</h1>
        <p className="cx-muted">
          Signed in as <strong>{email}</strong>. Grey text in a field is a suggestion: it is used as it is unless you type
          over it. You can change all of this later in your hub's Settings.
        </p>
      </header>

      <form
        className="cx-card cx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset>
          <legend>Kind of hub</legend>
          <div className="cx-field" role="radiogroup" aria-label="Kind of hub">
            {HUB_KINDS.map((k) => (
              <label key={k.id} className="cx-radio">
                <input
                  type="radio"
                  name="hub_kind"
                  checked={hubKind === k.id}
                  onChange={() => {
                    setHubKind(k.id);
                    if (k.id !== "place" && choice.kind === "unlinked") setChoice({ kind: "none" });
                    if (k.id === "place" && choice.kind === "none") setChoice({ kind: "unlinked" });
                  }}
                />
                <span>
                  <strong>{k.label}</strong>
                  <small className="cx-muted">{k.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{isPlace ? "Place" : "Related place"}</legend>
          <JurisdictionPicker
            value={choice}
            onChange={(next) => {
              setChoice(next);
              set("jurisdiction_name", "");
            }}
            optional={!isPlace}
            onTypeChange={setPickerType}
            source={startJurisdictions}
            plain
          />
          {(choice.kind === "custom" || listed) && (
            <label className="cx-field">
              <span>Place name</span>
              <SuggestInput
                required={choice.kind === "custom"}
                value={form.jurisdiction_name}
                suggestion={suggestedPlaceName}
                onChange={(v) => set("jurisdiction_name", v)}
                placeholder="The Northside neighbourhood"
              />
              <small className="cx-muted">
                {isPlace
                  ? `People joining confirm: "I am a resident of ${placeName.trim() || "…"}".`
                  : "Names the hub's related place."}
              </small>
            </label>
          )}
          {isPlace && choice.kind === "custom" && (
            <label className="cx-field">
              <span>Type of place</span>
              <select value={form.jurisdiction_type} onChange={(e) => set("jurisdiction_type", e.target.value)}>
                <option value="">Choose…</option>
                {JURISDICTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isPlace && (
            <div className="cx-two">
              <label className="cx-field">
                <span>
                  Governing body <em>optional</em>
                </span>
                <SuggestInput
                  value={form.governing_body}
                  suggestion={suggest.governing_body}
                  onChange={(v) => set("governing_body", v)}
                  placeholder="Town Council"
                />
                <small className="cx-muted">
                  The body your hub's results go to.
                </small>
              </label>
              <label className="cx-field">
                <span>Board label</span>
                <SuggestInput
                  maxLength={40}
                  value={form.governing_body_short}
                  suggestion={suggestShort}
                  onChange={(v) => set("governing_body_short", v)}
                  placeholder="Council"
                />
                <small className="cx-muted">
                  The short form: "{governingBodyShort || "Council"} meeting summaries".
                </small>
              </label>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Your hub</legend>
          <label className="cx-field">
            <span>Hub name</span>
            <SuggestInput
              required={!suggest.name}
              value={form.name}
              suggestion={suggest.name}
              onChange={(v) => set("name", v)}
              placeholder="Northside Civic Hub"
            />
            <small className="cx-muted">
              Shown in the site header and as the sender name on emails.
            </small>
          </label>
          <div className="cx-field">
            <label htmlFor="st-slug">
              <span className="cx-field-label">Web address</span>
            </label>
            <div className="cx-address">
              <SuggestInput
                id="st-slug"
                className="cx-mono"
                value={form.slug}
                suggestion={suggestedSlug}
                aria-invalid={slugProblem ? true : undefined}
                onChange={(v) => set("slug", v.toLowerCase())}
              />
              <span className="cx-mono cx-muted">.{domain || "…"}</span>
            </div>
            <small className={slugProblem ? "cx-error-text" : "cx-muted"}>
              {slugProblem ?? "Your hub's address. It can be changed later, and old links keep working."}
            </small>
          </div>
          <label className="cx-field">
            <span>Time zone</span>
            <SuggestInput
              className="cx-mono"
              value={form.timezone}
              suggestion={suggest.timezone}
              onChange={(v) => set("timezone", v.trim())}
              placeholder="America/New_York"
            />
            <small className="cx-muted">
              For dates and the daily email's send hour.
              {listed && SPLIT_STATES.has(listed.state) && " This state spans more than one time zone: check it."}
            </small>
          </label>
        </fieldset>

        <fieldset>
          <legend>Who runs it</legend>
          <div className="cx-two">
            <label className="cx-field">
              <span>Operated by</span>
              <SuggestInput value={form.operator_name} suggestion={name} onChange={(v) => set("operator_name", v)} />
              <small className="cx-muted">
                Named in the hub's terms: a person, a group or an office.
              </small>
            </label>
            <label className="cx-field">
              <span>Contact address</span>
              <SuggestInput type="email" value={form.contact_email} suggestion={email} onChange={(v) => set("contact_email", v.trim())} />
              <small className="cx-muted">
                Where people write about the hub. Shown on its legal pages.
              </small>
            </label>
          </div>
        </fieldset>

        <div className="st-demo-note">
          <strong>Your hub starts as a demo.</strong> Sample content shows what it can do, visitors can sign in with any
          six digits, and no email goes to them. When you're ready, remove the samples and move it to beta in its
          Settings.
        </div>

        {error && (
          <p className="cx-alert cx-alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="cx-btn cx-btn-primary cx-block" disabled={busy || !ready}>
          {busy ? "Creating your hub… this takes a few seconds" : "Create my hub"}
        </button>
      </form>
      <p className="st-leave">
        <button type="button" className="cx-linkbtn" onClick={onLeave}>
          Start over with a different code
        </button>
      </p>
    </main>
  );
}
