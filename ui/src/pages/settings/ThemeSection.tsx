// Theme — a hub's colours. Presets, three base colours and one hue per
// process type; every other shade is derived (src/shared/theme.ts), and any
// choice that would hurt readability is adjusted and reported, never saved
// as picked.
//
// The live preview is a `.theme-scope` box carrying previewVars(): the same
// variables the page would get, re-declared inside the box, so what it shows
// is the real stylesheet under the draft theme — not a picture of it.

import { useId, useMemo } from "react";
import {
  DEFAULT_THEME_COLORS,
  THEME_PRESETS,
  THEME_TYPE_KEYS,
  parseTheme,
  previewVars,
  resolveTheme,
  serializeTheme,
  themeTypeLabel,
  type HubTheme,
  type ThemeTypeKey,
} from "../../../../src/shared/theme";
import { applyTheme } from "../../config/hubConfig";
import SectionForm, { type FormApi } from "./SectionForm";

const KEY = "identity.theme";

export default function ThemeSection() {
  return (
    <SectionForm
      section="theme"
      title="Theme"
      intro={
        <p className="form-hint">
          The colours of the whole site. Start from a preset, then change the
          base colours or any process type&apos;s colour. Every lighter and
          darker shade is worked out for you, and a colour that would make text
          hard to read is adjusted just enough to pass, with the change shown.
        </p>
      }
      savedMessage="Saved. The site wears it now; visitors see it on their next page load."
      onSaved={(fresh) => applyTheme(fresh.values[KEY])}
    >
      {(f) => <ThemeEditor f={f} />}
    </SectionForm>
  );
}

function ThemeEditor({ f }: { f: FormApi }) {
  const theme = useMemo(() => parseTheme(f.value(KEY)), [f]);
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const preset = THEME_PRESETS.find((p) => p.id === (theme.preset ?? "default"));

  function update(next: HubTheme) {
    f.set(KEY, serializeTheme(next));
  }

  /** What a base colour is when the admin has not picked one. */
  function baseOf(k: "primary" | "accent" | "background"): string {
    return preset?.[k] ?? DEFAULT_THEME_COLORS[k];
  }

  return (
    <>
      <div className="settings-field">
        <span className="form-label settings-field-label">Preset</span>
        <p className="form-hint">
          Choosing a preset starts over from its colours; your own picks below
          are cleared.
        </p>
        <div className="theme-presets" role="radiogroup" aria-label="Preset">
          {THEME_PRESETS.map((p) => {
            const r = resolveTheme({ preset: p.id });
            const selected =
              (theme.preset ?? "default") === p.id &&
              !theme.primary &&
              !theme.accent &&
              !theme.background &&
              !theme.types;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`theme-preset${selected ? " is-selected" : ""}`}
                onClick={() => update({ preset: p.id })}
                disabled={f.disabled}
              >
                <span className="theme-preset-swatches" aria-hidden="true">
                  <span style={{ background: r.effective.primary }} />
                  <span style={{ background: r.effective.accent }} />
                  <span style={{ background: r.effective.background }} />
                </span>
                <span className="theme-preset-label">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-field">
        <span className="form-label settings-field-label">Base colours</span>
        <div className="theme-rows">
          <ColourRow
            label="Primary"
            hint="Buttons, links, the active tab, votes."
            value={theme.primary}
            base={baseOf("primary")}
            disabled={f.disabled}
            onChange={(v) => update({ ...theme, primary: v })}
          />
          <ColourRow
            label="Accent"
            hint="Calls to action like “Raise something”, announcements, briefs."
            value={theme.accent}
            base={baseOf("accent")}
            disabled={f.disabled}
            onChange={(v) => update({ ...theme, accent: v })}
          />
          <ColourRow
            label="Background"
            hint="The page behind the cards. Keep it light."
            value={theme.background}
            base={baseOf("background")}
            disabled={f.disabled}
            onChange={(v) => update({ ...theme, background: v })}
          />
        </div>
      </div>

      <div className="settings-field">
        <span className="form-label settings-field-label">Process types</span>
        <p className="form-hint">
          One colour per kind of thing. It becomes the card&apos;s top edge and
          the pill&apos;s text, with a light pill background made from it.
        </p>
        <div className="theme-rows">
          {THEME_TYPE_KEYS.map((k) => (
            <ColourRow
              key={k}
              label={themeTypeLabel(k)}
              value={theme.types?.[k]}
              base={resolved.effective.types[k]}
              disabled={f.disabled}
              onChange={(v) => {
                const types = { ...(theme.types ?? {}) } as Partial<Record<ThemeTypeKey, string>>;
                if (v) types[k] = v;
                else delete types[k];
                update({ ...theme, types });
              }}
            />
          ))}
        </div>
      </div>

      {resolved.adjustments.length > 0 && (
        <div className="theme-adjustments" role="status">
          <p className="theme-adjustments-title">Adjusted for readability</p>
          <ul>
            {resolved.adjustments.map((a) => (
              <li key={a.what}>
                <strong>{a.what}</strong>: <Swatch hex={a.from} /> {a.from} →{" "}
                <Swatch hex={a.to} /> {a.to}, {a.why}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="settings-field">
        <span className="form-label settings-field-label">Preview</span>
        <ThemePreview theme={theme} />
      </div>
    </>
  );
}

/**
 * One colour choice: the colour in effect, a picker, and "Use default" when
 * the admin has picked one. `value` undefined means "not picked".
 */
function ColourRow({
  label,
  hint,
  value,
  base,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | undefined;
  base: string;
  disabled: boolean;
  onChange: (next: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="theme-row">
      <input
        id={id}
        type="color"
        className="settings-color-swatch"
        value={value ?? base}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        disabled={disabled}
      />
      <label htmlFor={id} className="theme-row-text">
        <span className="theme-row-label">{label}</span>
        {hint && <span className="theme-row-hint">{hint}</span>}
      </label>
      <code className="theme-row-hex">{value ?? base}</code>
      {value ? (
        <button
          type="button"
          className="admin-remove-section"
          onClick={() => onChange(undefined)}
          disabled={disabled}
        >
          Use default
        </button>
      ) : (
        <span className="theme-row-default">Default</span>
      )}
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return <span className="theme-swatch" style={{ background: hex }} aria-hidden="true" />;
}

/** The real stylesheet under the draft theme, inside a box. */
function ThemePreview({ theme }: { theme: HubTheme }) {
  const vars = previewVars(resolveTheme(theme));
  return (
    <div className="theme-scope theme-preview" style={vars as React.CSSProperties}>
      <div className="theme-preview-bar">
        <span className="theme-preview-name">Your hub</span>
        <span className="theme-preview-tab is-active">Feed</span>
        <span className="theme-preview-tab">Votes</span>
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-actions">
          <button type="button" className="admin-convert-button" tabIndex={-1}>
            Primary button
          </button>
          <button type="button" className="home-start-btn" tabIndex={-1}>
            + Raise something
          </button>
          <a href="#theme-preview" onClick={(e) => e.preventDefault()} tabIndex={-1}>
            A link
          </a>
        </div>
        <div className="theme-preview-cards">
          {THEME_TYPE_KEYS.map((k) => (
            <div
              key={k}
              className="theme-preview-card"
              style={
                {
                  "--card-edge": `var(--type-${k}-fg)`,
                  "--card-pill-bg": `var(--type-${k}-bg)`,
                } as React.CSSProperties
              }
            >
              <span className="theme-preview-pill">{themeTypeLabel(k)}</span>
              <span className="theme-preview-title">A {themeTypeLabel(k).toLowerCase()} card</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
