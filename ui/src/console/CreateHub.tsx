// Create a hub (the console). Since 2026-10-06 (Adam) the form says where
// each value ends up, and once a place is chosen it SUGGESTS the rest: grey
// text inside an empty field. A suggestion is used as it is unless the
// operator types over it; Tab or Enter makes it real text to edit. A field
// the operator has typed in is never changed by the form. A plain-text
// preview beside the form shows the result as it is filled in — styled text
// only, built from the shared pure helpers, never the hub's own components.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ConsoleConfig, type HubMode, type SlugSuggestion } from "./api";
import { go, href } from "./route";
import {
  JURISDICTION_TYPES,
  defaultGoverningBody,
  defaultGoverningBodyShort,
  hubTypeFor,
  isJurisdictionType,
  type ReferenceJurisdictionType,
} from "../../../src/shared/jurisdictionType";
import { defaultHubName, jurisdictionCodeFor } from "../../../src/shared/jurisdictionNames";
import { fillSampleText } from "../../../src/shared/hubCopy";
import { JurisdictionPicker, type JurisdictionChoice } from "./JurisdictionPicker";
import { PLUGIN_NAMES } from "./pluginNames";
import { DEFAULT_HUB_BANNER } from "../../../src/shared/platform";
import { HUB_KINDS, affiliationClause, type HubKind } from "../../../src/shared/hubKind";
import { SPLIT_STATES, suggestedTimeZone } from "../../../src/shared/stateTimeZones";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

const MODES: Array<{ id: HubMode; label: string; hint: string }> = [
  { id: "demo", label: "Demo", hint: "Anyone signs in with any six digits; no email is sent. Its admin can move it to beta or live later." },
  { id: "beta", label: "Beta", hint: "Real codes by email; only the allow list may join, everyone else is offered the waitlist." },
  { id: "live", label: "Live", hint: "Real codes by email; open to anyone." },
];

/**
 * A text field that shows a suggestion as grey text while it is empty. Tab
 * or Enter on the empty field accepts it (Tab then stays, so the text can be
 * edited); typing replaces it. The parent submits `value || suggestion`.
 */
function SuggestInput({
  value,
  suggestion,
  onChange,
  placeholder,
  className,
  ...rest
}: {
  value: string;
  suggestion: string;
  onChange: (v: string) => void;
  placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const suggesting = value === "" && suggestion !== "";
  return (
    <input
      {...rest}
      value={value}
      placeholder={suggesting ? suggestion : placeholder}
      className={[className, suggesting ? "cx-suggesting" : ""].filter(Boolean).join(" ") || undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (suggesting && (e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
          e.preventDefault();
          onChange(suggestion);
        }
      }}
    />
  );
}

/** The hint under a field that holds a suggestion. */
function SuggestNote({ value, suggestion }: { value: string; suggestion: string }) {
  if (value !== "" || suggestion === "") return null;
  return (
    <span className="cx-suggest-note">
      {" "}Suggested: saved as shown if you leave it. Tab makes it text you can edit; typing replaces it.
    </span>
  );
}

/** The place as it reads mid-sentence: no state. */
function placeWithoutState(name: string): string {
  return name.trim().replace(/,\s*[^,]+$/, "").trim();
}

export default function CreateHub() {
  const [config, setConfig] = useState<ConsoleConfig | null>(null);
  // Only what the operator typed. Suggestions are computed, never stored here.
  const [form, setForm] = useState({
    name: "",
    slug: "",
    custom_hostname: "",
    jurisdiction_name: "",
    jurisdiction_type: "",
    governing_body: "",
    governing_body_short: "",
    timezone: "",
    admin_email: "",
    mode: "demo" as HubMode,
    sample_content: true,
  });
  const [customDomain, setCustomDomain] = useState(false);
  const [choice, setChoice] = useState<JurisdictionChoice>({ kind: "unlinked" });
  const [hubKind, setHubKind] = useState<HubKind>("place");
  const [pickerType, setPickerType] = useState<ReferenceJurisdictionType | "">("");
  const isPlace = hubKind === "place";
  const [plugins, setPlugins] = useState<Record<string, boolean>>({});
  const [suggestion, setSuggestion] = useState<SlugSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        setPlugins(Object.fromEntries(c.plugin_ids.map((id) => [id, true])));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --- Suggestions: what the chosen place implies --------------------------

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
    timezone: isPlace && listed ? suggestedTimeZone(listed.state) : "",
  };
  const governingBody = isPlace ? form.governing_body || suggest.governing_body : "";
  const suggestShort = governingBody ? defaultGoverningBodyShort(governingBody) : "";
  const governingBodyShort = governingBody ? form.governing_body_short || suggestShort : "";
  const name = form.name || suggest.name;
  const timezone = isPlace ? form.timezone || suggest.timezone : form.timezone;

  // The web address: the shortest free one, from the place (or the custom
  // name, or the hub's name), until the operator types their own.
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
      api
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
  const domain = config?.platform_domain ?? "";
  // With no platform domain configured (a local console), the full domain is typed.
  const ownDomain = customDomain || (config !== null && !domain);
  const hostname = ownDomain ? form.custom_hostname : slug && domain ? `${slug}.${domain}` : "";

  const slugProblem = useMemo(() => {
    if (!slug) return null;
    if (!SLUG_RE.test(slug)) return "2–32 characters: lowercase letters, digits and hyphens, not at either end.";
    const purpose = config?.reserved_slugs[slug];
    return purpose ? `Reserved: ${purpose}.` : null;
  }, [slug, config]);

  const pluginIds = config?.plugin_ids ?? [];
  const pluginsOn = pluginIds.filter((id) => plugins[id] !== false).length;
  const refusal = config?.create_refusal ?? null;
  // Every new hub's place is a row of the list, or deliberately custom.
  // A place hub needs one; any other kind may have none.
  const placeReady =
    choice.kind === "listed" ||
    (choice.kind === "custom" && placeName.trim() !== "") ||
    (!isPlace && (choice.kind === "none" || choice.kind === "unlinked"));
  const samplesAvailable = config ? config.sample_kinds.includes(hubKind) : true;
  const ready = name && slug && hostname && form.admin_email && !slugProblem && !refusal && placeReady;

  const slugHint = (() => {
    if (slugProblem) return slugProblem;
    if (!form.slug && suggestion?.slug && suggestion.passed_over.length > 0) {
      return `Your hub's web address: the shortest free one. Passed over ${suggestion.passed_over
        .map((p) => `${p.slug} (${p.reason})`)
        .join(", ")}.`;
    }
    return "Your hub's web address, and its permanent id. Two hubs may share a name, never an address.";
  })();

  // --- The preview ---------------------------------------------------------

  const previewPlace = placeName ? placeWithoutState(placeName) : name;
  // A card that will be seeded for this kind and type (review R21), filled
  // the way the seed fills it, articles included.
  const samplePreview = config?.sample_previews?.[`${hubKind}:${isPlace ? hubType || "" : ""}`] ?? null;
  const sampleTitle = samplePreview
    ? fillSampleText(samplePreview.title, {
        JURISDICTION: previewPlace || "your place",
        GOVERNING_BODY: governingBody || "local government",
        HUB_NAME: name || "your hub",
      })
    : "";
  const signUpLine = affiliationClause(hubKind, { place: placeName || "…", hub: name || "…" });

  return (
    <section className="cx-create-page">
      <p className="cx-crumb">
        <a href={href({ name: "hubs" })}>Hubs</a> / New
      </p>
      <h1 className="cx-title">Create a hub</h1>
      <p className="cx-muted">
        Creates the hub's registry row and its starter settings, with its first admin. Grey text in a field is a
        suggestion: it is used as it is unless you type over it.
      </p>

      {refusal && (
        <p className="cx-alert cx-alert-error" role="alert">
          {refusal}
        </p>
      )}

      <div className="cx-create-layout">
        <form
          className="cx-card cx-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const hasPlace = choice.kind === "listed" || choice.kind === "custom";
              const created = await api.createHub({
                name,
                slug,
                hostname,
                admin_email: form.admin_email,
                mode: form.mode,
                hub_kind: hubKind,
                jurisdiction_name: hasPlace ? placeName : "",
                jurisdiction_type: isPlace ? hubType : "",
                governing_body: governingBody,
                governing_body_short: governingBodyShort,
                timezone,
                jurisdiction_ocd_id: listed ? listed.ocd_id : null,
                jurisdiction_custom: choice.kind === "custom",
                sample_content: form.sample_content && samplesAvailable,
                plugins,
              });
              const seeded = created.sample_content;
              if (seeded && "error" in seeded) {
                window.alert(
                  `The hub was created, but its sample content could not be added: ${seeded.error}\n\n` +
                    `Run scripts/seed-sample-content.ts --hub ${created.hub.id} to try again.`,
                );
              }
              go({ name: "hub", id: created.hub.id });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset>
            <legend>Kind of hub</legend>
            <small className="cx-muted cx-slug-note">Decides who takes part and what they confirm when they join.</small>
            <div className="cx-field" role="radiogroup" aria-label="Kind of hub">
              {HUB_KINDS.map((k) => (
                <label key={k.id} className="cx-radio">
                  <input
                    type="radio"
                    name="hub_kind"
                    checked={hubKind === k.id}
                    onChange={() => {
                      setHubKind(k.id);
                      // Leaving "place": no place until one is chosen; back to it: choose one.
                      if (k.id !== "place" && choice.kind === "unlinked") setChoice({ kind: "none" });
                      if (k.id === "place" && choice.kind === "none") setChoice({ kind: "unlinked" });
                    }}
                  />
                  <span>
                    <strong>{k.label}</strong>
                    {k.id === "place" && <span className="cx-muted"> (default)</span>}
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
                // A typed place name belongs to the place it was typed for.
                set("jurisdiction_name", "");
              }}
              optional={!isPlace}
              onTypeChange={setPickerType}
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
                    ? `Shown at sign-up: "I confirm that I am a resident of ${placeName.trim() || "…"}".`
                    : "Names the hub's related place."}
                  <SuggestNote value={form.jurisdiction_name} suggestion={suggestedPlaceName} />
                </small>
              </label>
            )}
            {listed && (
              <p className="cx-muted cx-small">
                Jurisdiction code <span className="cx-mono">{placeCode || "—"}</span>: derived from the OCD id once,
                when the hub is created, and never changed.
              </p>
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
                <small className="cx-muted">Sets the usual governing body and which sample content fits.</small>
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
                    Named in sample content and on delivered results.
                    <SuggestNote value={form.governing_body} suggestion={suggest.governing_body} />
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
                    <SuggestNote value={form.governing_body_short} suggestion={suggestShort} />
                  </small>
                </label>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Identity</legend>
            <label className="cx-field">
              <span>Hub name</span>
              <SuggestInput
                required={!suggest.name}
                value={form.name}
                suggestion={suggest.name}
                onChange={(v) => set("name", v)}
                placeholder="Utopia Civic Hub"
              />
              <small className="cx-muted">
                Shown in the site header, the browser tab and as the sender name on emails.
                <SuggestNote value={form.name} suggestion={suggest.name} />
              </small>
            </label>
            {!ownDomain ? (
              <div className="cx-field">
                <label htmlFor="cx-slug">
                  <span className="cx-field-label">Web address</span>
                </label>
                <div className="cx-address">
                  <SuggestInput
                    id="cx-slug"
                    className="cx-mono"
                    value={form.slug}
                    suggestion={suggestedSlug}
                    aria-invalid={slugProblem ? true : undefined}
                    onChange={(v) => set("slug", v.toLowerCase())}
                  />
                  <span className="cx-mono cx-muted">.{domain || "…"}</span>
                </div>
                <small className={slugProblem ? "cx-error-text" : "cx-muted"}>
                  {slugHint}
                  {!slugProblem && <SuggestNote value={form.slug} suggestion={suggestedSlug} />}{" "}
                  <button type="button" className="cx-linkbtn" onClick={() => setCustomDomain(true)}>
                    Use a different domain
                  </button>
                </small>
              </div>
            ) : (
              <>
                <label className="cx-field">
                  <span>Hub id</span>
                  <SuggestInput
                    className="cx-mono"
                    value={form.slug}
                    suggestion={suggestedSlug}
                    aria-invalid={slugProblem ? true : undefined}
                    onChange={(v) => set("slug", v.toLowerCase())}
                  />
                  <small className={slugProblem ? "cx-error-text" : "cx-muted"}>
                    {slugProblem ?? "Permanent; stamped on every row the hub owns."}
                  </small>
                </label>
                <label className="cx-field">
                  <span>Domain</span>
                  <input
                    required
                    className="cx-mono"
                    value={form.custom_hostname}
                    onChange={(e) => set("custom_hostname", e.target.value.toLowerCase().trim())}
                    placeholder="civic.example.org"
                  />
                  <small className="cx-muted">
                    The full web address. Must also be added as a domain on the Vercel project.{" "}
                    {domain && (
                      <button type="button" className="cx-linkbtn" onClick={() => setCustomDomain(false)}>
                        Use .{domain}
                      </button>
                    )}
                  </small>
                </label>
              </>
            )}
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
                Dates and the daily digest's send hour. The hub's admin can change it in Settings → Identity.
                {listed && SPLIT_STATES.has(listed.state) && " This state spans more than one time zone: check it."}
                <SuggestNote value={form.timezone} suggestion={suggest.timezone} />
              </small>
            </label>
          </fieldset>

          <details className="cx-details">
            <summary>
              Plugins
              <span className="cx-muted">
                {pluginsOn === pluginIds.length ? `all ${pluginIds.length} on` : `${pluginsOn} of ${pluginIds.length} on`}
              </span>
            </summary>
            <p className="cx-muted cx-small">
              The features the hub starts with. Every plugin is on unless you untick it; the hub's admin can switch them
              later. Sample content is added for every plugin, and stays hidden until its plugin is on.
            </p>
            <ul className="cx-toggles">
              {pluginIds.map((id) => (
                <li key={id}>
                  <label className="cx-check">
                    <input type="checkbox" checked={plugins[id] !== false} onChange={(e) => setPlugins({ ...plugins, [id]: e.target.checked })} />
                    {PLUGIN_NAMES[id] ?? id}
                  </label>
                </li>
              ))}
            </ul>
          </details>

          <fieldset>
            <legend>People and access</legend>
            <label className="cx-field">
              <span>First admin</span>
              <input
                type="email"
                required
                value={form.admin_email}
                onChange={(e) => set("admin_email", e.target.value.trim())}
                placeholder="name@example.org"
              />
              <small className="cx-muted">
                Their email. They sign in with a real code, even on a demo hub, and run the hub's Settings.
              </small>
            </label>
            <div className="cx-field" role="radiogroup" aria-label="Who can join">
              <span>Who can join</span>
              {MODES.map((m) => (
                <label key={m.id} className="cx-radio">
                  <input type="radio" name="mode" checked={form.mode === m.id} onChange={() => set("mode", m.id)} />
                  <span>
                    <strong>{m.label}</strong>
                    {m.id === "demo" && <span className="cx-muted"> (default)</span>}
                    <small className="cx-muted">{m.hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="cx-radio">
              <input
                type="checkbox"
                checked={form.sample_content && samplesAvailable}
                disabled={!samplesAvailable}
                onChange={(e) => set("sample_content", e.target.checked)}
              />
              <span>
                <strong>Start with sample content</strong>
                <small className="cx-muted">
                  {samplesAvailable
                    ? "Up to eleven illustrative processes, marked Sample, so the hub never opens empty. Its admin can remove them in one step from Settings."
                    : "No sample content is available for this kind of hub yet."}
                </small>
              </span>
            </label>
          </fieldset>

          {error && (
            <p className="cx-alert cx-alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="cx-actions">
            <a className="cx-btn cx-btn-quiet" href={href({ name: "hubs" })}>
              Cancel
            </a>
            <button className="cx-btn cx-btn-primary" disabled={!ready || busy}>
              {busy ? "Creating…" : "Create hub"}
            </button>
          </div>
        </form>

        <aside className="cx-card cx-preview" aria-label="Preview">
          <p className="cx-eyebrow">Preview</p>
          <p className="cx-preview-address cx-mono">{hostname ? `https://${hostname}` : "https://…"}</p>
          {/* Every new hub starts with this banner; its admin replaces it. */}
          <img className="cx-preview-banner" src={DEFAULT_HUB_BANNER.url} alt="" />
          <div className="cx-preview-header">
            <span className="cx-preview-logo" aria-hidden="true">
              {(name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="cx-preview-name">{name || "Hub name"}</span>
          </div>
          <div className="cx-preview-pills">
            <span>All</span>
            <span>{governingBodyShort ? `${governingBodyShort} meeting summaries` : "Meeting summaries"}</span>
          </div>
          {form.sample_content && samplesAvailable && sampleTitle ? (
            <div className="cx-preview-card">
              <span className="cx-preview-pill">{samplePreview?.pill ?? "Vote open"}</span>
              <span className="cx-preview-pill cx-preview-sample">Sample</span>
              <p>{sampleTitle}</p>
            </div>
          ) : (
            <p className="cx-muted cx-small">No sample content.</p>
          )}
          <p className="cx-small cx-preview-signup">
            <span className="cx-muted">Sign-up: </span>
            {signUpLine ? `${signUpLine}, and I have read…` : "I have read and agree to the Terms…"}
          </p>
          {timezone && <p className="cx-small cx-muted">Times in {timezone}</p>}
        </aside>
      </div>
    </section>
  );
}
