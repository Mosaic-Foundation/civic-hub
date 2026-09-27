import { useEffect, useMemo, useState } from "react";
import { api, type ConsoleConfig, type HubMode } from "./api";
import { go, href } from "./route";
import { JURISDICTION_TYPES, defaultGoverningBody, isJurisdictionType } from "../../../src/shared/jurisdictionType";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

const MODES: Array<{ id: HubMode; label: string; hint: string }> = [
  { id: "demo", label: "Demo", hint: "Anyone signs in with any six digits; no email is sent. Its admin can move it to beta or live later." },
  { id: "beta", label: "Beta", hint: "Real codes by email; only the allow list may join, everyone else is offered the waitlist." },
  { id: "live", label: "Live", hint: "Real codes by email; open to anyone." },
];

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/civic hub/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

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
  const [touched, setTouched] = useState({ slug: false, hostname: false, governing_body: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch((e: Error) => setError(e.message));
  }, []);

  const suggestedHost = (slug: string) => (config?.platform_domain && slug ? `${slug}.${config.platform_domain}` : "");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "name" && !touched.slug) next.slug = slugFrom(String(value));
      if ((key === "name" || key === "slug") && !touched.hostname) next.hostname = suggestedHost(next.slug);
      // The usual governing body for the type (and, for a county, the state
      // in the code) until the operator types their own.
      if ((key === "jurisdiction_type" || key === "jurisdiction_code") && !touched.governing_body) {
        const t = next.jurisdiction_type;
        next.governing_body = isJurisdictionType(t) ? defaultGoverningBody(t, next.jurisdiction_code) : "";
      }
      return next;
    });
  }

  const slugProblem = useMemo(() => {
    if (!form.slug) return null;
    if (!SLUG_RE.test(form.slug)) return "2–32 characters: lowercase letters, digits and hyphens, not at either end.";
    const purpose = config?.reserved_slugs[form.slug];
    return purpose ? `Reserved: ${purpose}.` : null;
  }, [form.slug, config]);

  const refusal = config?.create_refusal ?? null;
  const ready = form.name && form.slug && form.hostname && form.admin_email && !slugProblem && !refusal;

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
            const created = await api.createHub({ ...form });
            go({ name: "hub", id: created.hub.id });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
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
            <small className={slugProblem ? "cx-error-text" : "cx-muted"}>
              {slugProblem ?? "The hub's permanent id. Stamped on every row it owns; never changes."}
            </small>
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

        <fieldset>
          <legend>Place</legend>
          <label className="cx-field">
            <span>Jurisdiction</span>
            <input value={form.jurisdiction_name} onChange={(e) => set("jurisdiction_name", e.target.value)} placeholder="Utopia County, Virginia" />
          </label>
          <label className="cx-field">
            <span>Jurisdiction code <em>optional</em></span>
            <input className="cx-mono" value={form.jurisdiction_code} onChange={(e) => set("jurisdiction_code", e.target.value.toLowerCase())} placeholder="us-va-utopia" />
          </label>
          <label className="cx-field">
            <span>Jurisdiction type</span>
            <select value={form.jurisdiction_type} onChange={(e) => set("jurisdiction_type", e.target.value)}>
              <option value="">Choose…</option>
              {JURISDICTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <small className="cx-muted">Fills in the usual governing body, and decides which sample content fits.</small>
          </label>
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
        </fieldset>

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
              checked={form.sample_content}
              onChange={(e) => set("sample_content", e.target.checked)}
            />
            <span>
              <strong>Start with sample content</strong>
              <small className="cx-muted">
                Up to nine illustrative processes, marked Sample, so the hub never opens empty. Its admin can remove them
                in one step from Settings.
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
