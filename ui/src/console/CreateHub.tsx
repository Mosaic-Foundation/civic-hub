import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ConsoleConfig, type HubMode, type SlugSuggestion } from "./api";
import { go, href } from "./route";
import { JURISDICTION_TYPES, defaultGoverningBody, hubTypeFor, isJurisdictionType } from "../../../src/shared/jurisdictionType";
import { jurisdictionCodeFor } from "../../../src/shared/jurisdictionNames";
import { JurisdictionPicker, type JurisdictionChoice } from "./JurisdictionPicker";
import { PLUGIN_NAMES } from "./pluginNames";
import { HUB_KINDS, type HubKind } from "../../../src/shared/hubKind";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

const MODES: Array<{ id: HubMode; label: string; hint: string }> = [
  { id: "demo", label: "Demo", hint: "Anyone signs in with any six digits; no email is sent. Its admin can move it to beta or live later." },
  { id: "beta", label: "Beta", hint: "Real codes by email; only the allow list may join, everyone else is offered the waitlist." },
  { id: "live", label: "Live", hint: "Real codes by email; open to anyone." },
];

export default function CreateHub() {
  const [config, setConfig] = useState<ConsoleConfig | null>(null);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    hostname: "",
    jurisdiction_name: "",
    jurisdiction_code: "",
    jurisdiction_type: "",
    governing_body: "",
    admin_email: "",
    mode: "demo" as HubMode,
    sample_content: true,
  });
  const [choice, setChoice] = useState<JurisdictionChoice>({ kind: "unlinked" });
  const [hubKind, setHubKind] = useState<HubKind>("place");
  const isPlace = hubKind === "place";
  const [plugins, setPlugins] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState({ slug: false, hostname: false, governing_body: false });
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

  const suggestedHost = (slug: string) => (config?.platform_domain && slug ? `${slug}.${config.platform_domain}` : "");

  // Read through a ref: set() also runs from the slug suggestion's async
  // callback, whose closure would otherwise hold an old `touched` and
  // overwrite a hostname the operator has since typed.
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "slug" && !touchedRef.current.hostname) next.hostname = suggestedHost(String(value));
      if ((key === "jurisdiction_type" || key === "jurisdiction_code") && !touchedRef.current.governing_body) {
        const t = next.jurisdiction_type;
        next.governing_body = isJurisdictionType(t)
          ? defaultGoverningBody(t, next.jurisdiction_code, choice.kind === "listed" ? choice.row.ocd_id : null)
          : "";
      }
      return next;
    });
  }

  // Choosing from the list fills the display name, the code, the type and
  // the usual governing body; the operator can still correct each one.
  function pick(next: JurisdictionChoice) {
    const wasListed = choice.kind === "listed";
    setChoice(next);
    if ((next.kind === "custom" && wasListed) || next.kind === "none") {
      setForm((f) => ({ ...f, jurisdiction_name: "", jurisdiction_code: "" }));
    }
    if (next.kind !== "listed") return;
    const { row } = next;
    const hubType = hubTypeFor(row.type);
    const code = jurisdictionCodeFor(row) ?? "";
    setForm((f) => ({
      ...f,
      jurisdiction_name: row.display_name,
      jurisdiction_code: code,
      jurisdiction_type: isPlace ? hubType : "",
      governing_body: !isPlace ? "" : touched.governing_body ? f.governing_body : defaultGoverningBody(hubType, code, row.ocd_id),
    }));
  }

  // The slug: the shortest free address, from the chosen jurisdiction (or the
  // custom name, or the hub's name), until the operator types their own.
  const slugSource = useMemo(() => {
    if (choice.kind === "listed") return { name: choice.row.official_name, type: choice.row.type, state: choice.row.state };
    if (choice.kind === "custom" && form.jurisdiction_name) return { name: form.jurisdiction_name, type: null, state: null };
    const bare = form.name.replace(/civic hub/gi, "").trim();
    return bare ? { name: bare, type: null, state: null } : null;
  }, [choice, form.jurisdiction_name, form.name]);

  useEffect(() => {
    if (touched.slug || !slugSource) {
      if (!slugSource && !touched.slug) setSuggestion(null);
      return;
    }
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api
        .suggestSlug(slugSource.name, slugSource.type, slugSource.state)
        .then((s) => {
          if (n !== seq.current) return;
          setSuggestion(s);
          if (s.slug) set("slug", s.slug);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugSource, touched.slug]);

  const slugProblem = useMemo(() => {
    if (!form.slug) return null;
    if (!SLUG_RE.test(form.slug)) return "2–32 characters: lowercase letters, digits and hyphens, not at either end.";
    const purpose = config?.reserved_slugs[form.slug];
    return purpose ? `Reserved: ${purpose}.` : null;
  }, [form.slug, config]);

  const pluginIds = config?.plugin_ids ?? [];
  const pluginsOn = pluginIds.filter((id) => plugins[id] !== false).length;
  const refusal = config?.create_refusal ?? null;
  // Every new hub's place is a row of the list, or deliberately custom.
  // A place hub needs one; any other kind may have none.
  const placeReady =
    choice.kind === "listed" ||
    (choice.kind === "custom" && form.jurisdiction_name.trim() !== "") ||
    (!isPlace && (choice.kind === "none" || choice.kind === "unlinked"));
  const samplesAvailable = config ? config.sample_kinds.includes(hubKind) : true;
  const ready = form.name && form.slug && form.hostname && form.admin_email && !slugProblem && !refusal && placeReady;

  const slugHint = (() => {
    if (slugProblem) return slugProblem;
    if (!touched.slug && suggestion?.slug && suggestion.passed_over.length > 0) {
      return `Suggested: the shortest free address. Passed over ${suggestion.passed_over
        .map((p) => `${p.slug} (${p.reason})`)
        .join(", ")}.`;
    }
    if (!touched.slug && suggestion?.slug) return "Suggested: the shortest free address. The hub's permanent id; you can edit it.";
    return "The hub's permanent id. Stamped on every row it owns; never changes.";
  })();

  return (
    <section className="cx-narrow-page">
      <p className="cx-crumb">
        <a href={href({ name: "hubs" })}>Hubs</a> / New
      </p>
      <h1 className="cx-title">Create a hub</h1>
      <p className="cx-muted">
        Creates the hub's registry row and its starter settings, with its first admin. The same code as{" "}
        <code>scripts/create-hub.ts</code>.
      </p>

      {refusal && (
        <p className="cx-alert cx-alert-error" role="alert">
          {refusal}
        </p>
      )}

      <form
        className="cx-card cx-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const hasPlace = choice.kind === "listed" || choice.kind === "custom";
            // The code is derived by the server from the OCD id; never sent.
            const { jurisdiction_code: _code, ...rest } = form;
            void _code;
            const created = await api.createHub({
              ...rest,
              hub_kind: hubKind,
              jurisdiction_name: hasPlace ? form.jurisdiction_name : "",
              jurisdiction_type: isPlace ? form.jurisdiction_type : "",
              governing_body: isPlace ? form.governing_body : "",
              jurisdiction_ocd_id: choice.kind === "listed" ? choice.row.ocd_id : null,
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
          <JurisdictionPicker value={choice} onChange={pick} optional={!isPlace} />
          {choice.kind !== "none" && (
          <label className="cx-field">
            <span>{choice.kind === "custom" ? "Name of the jurisdiction" : "Display name"}</span>
            <input
              required={choice.kind === "custom"}
              value={form.jurisdiction_name}
              onChange={(e) => set("jurisdiction_name", e.target.value)}
              placeholder={choice.kind === "custom" ? "The Northside neighbourhood" : "Filled in from the list"}
            />
          </label>
          )}
          {choice.kind === "listed" && (
            <p className="cx-muted cx-small">
              Code <span className="cx-mono">{form.jurisdiction_code || "—"}</span>: derived from the OCD id once, when the
              hub is created, and never changed.
            </p>
          )}
          {isPlace && (<>
          <div className="cx-two">
            <label className="cx-field">
              <span>Hub type</span>
              <select value={form.jurisdiction_type} onChange={(e) => set("jurisdiction_type", e.target.value)}>
                <option value="">Choose…</option>
                {JURISDICTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <small className="cx-muted cx-slug-note">
            The hub type fills in the usual governing body and decides which sample content fits. Census-designated
            places and states count as Other.
          </small>
          <label className="cx-field">
            <span>Governing body <em>optional</em></span>
            <input
              value={form.governing_body}
              onChange={(e) => {
                setTouched((t) => ({ ...t, governing_body: true }));
                set("governing_body", e.target.value);
              }}
              placeholder="Town Council"
            />
            <small className="cx-muted">The usual name for the type is only usual. Correct it if this place says it differently.</small>
          </label>
          </>)}
        </fieldset>

        <fieldset>
          <legend>Identity</legend>
          <label className="cx-field">
            <span>Name</span>
            <input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Utopia Civic Hub" />
          </label>
          <label className="cx-field">
            <span>Slug</span>
            <input
              required
              className="cx-mono"
              value={form.slug}
              aria-invalid={slugProblem ? true : undefined}
              onChange={(e) => {
                setTouched((t) => ({ ...t, slug: true }));
                set("slug", e.target.value.toLowerCase());
              }}
            />
            <small className={slugProblem ? "cx-error-text" : "cx-muted"}>{slugHint}</small>
          </label>
          <label className="cx-field">
            <span>Hostname</span>
            <input
              required
              className="cx-mono"
              value={form.hostname}
              onChange={(e) => {
                setTouched((t) => ({ ...t, hostname: true }));
                set("hostname", e.target.value.toLowerCase().trim());
              }}
            />
            <small className="cx-muted">
              Must also be added as a domain on the Vercel project, or it will not reach this deployment.
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
            Every plugin is on unless you untick it; the hub's admin can switch them later. Sample content is added for
            every plugin, and stays hidden until its plugin is on.
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
            <span>First admin email</span>
            <input type="email" required value={form.admin_email} onChange={(e) => set("admin_email", e.target.value.trim())} />
            <small className="cx-muted">Signs in with a real code even on a demo hub.</small>
          </label>
          <div className="cx-field" role="radiogroup" aria-label="Mode">
            <span>Mode</span>
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
                  ? "Up to nine illustrative processes, marked Sample, so the hub never opens empty. Its admin can remove them in one step from Settings."
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
    </section>
  );
}
