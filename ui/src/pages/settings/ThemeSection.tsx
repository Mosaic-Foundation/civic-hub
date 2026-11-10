// Appearance (Theme until the design pass, 2026-10-29) — a hub's look.
// Presets, the base colours, the background's warmth, a font from a short
// list (decision 10) and one hue per process type; every other shade is
// derived (src/shared/theme.ts), and any choice that would hurt readability
// is adjusted and reported, never saved as picked. Stored as identity.theme:
// the admin's choices, which theme.ts turns into the hub's token overrides.
//
// The live preview is a `.theme-scope` box carrying previewVars(): the same
// variables the page would get, re-declared inside the box, so what it shows
// is the real stylesheet under the draft theme — not a picture of it.

import { useId, useMemo, useRef } from "react";
import {
  DEFAULT_THEME_COLORS,
  THEME_FONTS,
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
import { applyTheme, refreshHubConfig } from "../../config/hubConfig";
import { navSections, type NavSection } from "../../config/navigation";
import { BAR_SECTION_COUNT, parseSectionOrder } from "../../../../src/shared/navSections";
import HelpButton from "../../components/HelpButton";
import SectionForm, { type FormApi } from "./SectionForm";
import { Link } from "react-router-dom";
import { RadioCards, Select, SortableList, Switch } from "../../kit";
import { ASIDE_SETTING_KEY, asideCardsInOrder } from "../../aside/registry";
import { parseAsideCards, withOrder } from "../../../../src/shared/asideCards";
import { useHub } from "../../config/hub";

const KEY = "identity.theme";

export default function ThemeSection() {
  return (
    <SectionForm
      section="theme"
      title="Appearance"
      intro={
        <p className="form-hint">
          How the whole hub looks, for everyone, and every plugin&apos;s pages
          with it. Start from a preset, then change the colours, the
          background&apos;s warmth or the font. Every lighter and darker shade
          is worked out for you, and a colour that would make text hard to read
          is adjusted just enough to pass, with the change shown. Each person
          can still choose light or dark for themselves.
        </p>
      }
      onSaved={(fresh) => {
        applyTheme(fresh.values[KEY]);
        // The navigation redraws at once for the admin who saved it.
        void refreshHubConfig();
      }}
    >
      {(f) => (
        <>
          <ThemeEditor f={f} />
          <NavigationFields f={f} />
        </>
      )}
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
        <div className="settings-field-label-row">
          <span className="form-label settings-field-label">Preset</span>
          <HelpButton k={KEY} label="Colours" />
        </div>
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
        <span className="form-label settings-field-label" id="theme-warmth-label">
          Background
        </span>
        <p className="form-hint">From cool white to warm paper. Cards stay white on it.</p>
        <div className="theme-warmth" role="radiogroup" aria-labelledby="theme-warmth-label">
          {WARMTH.map((w) => {
            const current = (theme.background ?? baseOf("background")).toLowerCase();
            const on = current === w.hex;
            return (
              <button
                key={w.hex}
                type="button"
                role="radio"
                aria-checked={on}
                className={`theme-warmth-choice${on ? " is-selected" : ""}`}
                onClick={() => update({ ...theme, background: w.hex === DEFAULT_THEME_COLORS.background ? undefined : w.hex })}
                disabled={f.disabled}
              >
                <span className="theme-warmth-swatch" style={{ background: w.hex }} aria-hidden="true" />
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-field">
        <span className="form-label settings-field-label">Font</span>
        <RadioCards
          name="theme-font"
          label="Font"
          value={theme.font ?? "inter"}
          onChange={(v) => update({ ...theme, font: v === "inter" ? undefined : v })}
          options={THEME_FONTS.map((fo) => ({
            value: fo.id,
            title: <span className={`theme-font-sample theme-font-sample--${fo.heading}`}>{fo.label}</span>,
            body: fo.hint,
            disabled: f.disabled,
          }))}
        />
      </div>

      <LogoField />

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

/** The background's warmth, cool to warm; Warm is the default (Daylight). */
const WARMTH = [
  { label: "Cool", hex: "#f8f9fb" },
  { label: "Neutral", hex: "#fafaf9" },
  { label: "Warm", hex: DEFAULT_THEME_COLORS.background },
  { label: "Warmer", hex: "#f8f4ec" },
] as const;

/** The hub's logo, shown where its look is set; it is changed under Identity. */
function LogoField() {
  const hub = useHub();
  return (
    <div className="settings-field">
      <span className="form-label settings-field-label">Logo</span>
      <div className="theme-logo">
        {hub.logo_url ? (
          <img src={hub.logo_url} alt="" className="theme-logo-image" />
        ) : (
          <span className="form-hint">No logo yet.</span>
        )}
        <Link to="/admin/settings/identity#identity.logo_url">Change it under Identity</Link>
      </div>
    </div>
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

// --- Navigation (navigation slice, 2026-10-14) -------------------------------

const LAYOUT_KEY = "nav.layout";
const ORDER_KEY = "nav.section_order";

type LayoutId = "sidebar" | "top_tabs" | "three_columns";

// Relabelled on 2026-11-07 (Adam); the stored values are unchanged.
const LAYOUTS: ReadonlyArray<{ id: LayoutId; title: string; body: string }> = [
  {
    id: "top_tabs",
    title: "Top navigation",
    body: "The hub's name and menu along the top, and the sections as tabs under the banner. New hubs start with this.",
  },
  {
    id: "sidebar",
    title: "Left column",
    body: "The hub's sections in a column on the left of the screen, always in view.",
  },
  {
    id: "three_columns",
    title: "Three columns",
    body: "The sections on the left, the feed in the middle, and cards on the right: what's coming up, announcements and about the hub. On a smaller screen the cards go first.",
  },
];

/**
 * Where the sections are drawn on a computer, and their one order. Phones get
 * the bottom bar under either choice; its four tabs are the first four of the
 * order (Adam, 2026-10-14).
 */
function NavigationFields({ f }: { f: FormApi }) {
  // Unset is Top navigation: a hub made before the choice existed is unchanged.
  const storedLayout = f.value(LAYOUT_KEY);
  const layout: LayoutId = storedLayout === "sidebar" || storedLayout === "three_columns" ? storedLayout : "top_tabs";
  const stored = f.value(ORDER_KEY);
  // An admin orders Members even before its threshold shows it to residents.
  const sections = navSections({ order: parseSectionOrder(stored), admin: true });
  const movable = sections.filter((s) => s.kind !== "feed");
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());

  function move(id: string, by: -1 | 1) {
    const ids = movable.map((s) => s.id);
    const at = ids.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    // Only the sections the hub has now: one switched off later drops out,
    // and comes back at the end when it is switched on again.
    f.set(ORDER_KEY, JSON.stringify(ids));
    // Keep the keyboard on the row that moved; at an end, on its other button.
    requestAnimationFrame(() => {
      const same = buttons.current.get(`${id}:${by}`);
      const other = buttons.current.get(`${id}:${-by}`);
      (same && !same.disabled ? same : other)?.focus();
    });
  }

  const bar = sections.slice(0, BAR_SECTION_COUNT);

  return (
    <>
      <div className="settings-field" id="nav-layout">
        <div className="settings-field-label-row">
          <span className="form-label settings-field-label">Navigation</span>
          <HelpButton k="nav.layout" label="Navigation" />
        </div>
        <p className="form-hint">How the hub&apos;s sections are shown on a computer. Phones always get a bar at the bottom of the screen.</p>
        <fieldset className="settings-mode-choices" disabled={f.disabled}>
          <legend className="visually-hidden">Navigation</legend>
          {LAYOUTS.map((l) => (
            <label key={l.id} className={`settings-mode-choice${layout === l.id ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="nav-layout"
                value={l.id}
                checked={layout === l.id}
                onChange={() => f.set(LAYOUT_KEY, l.id)}
              />
              <span>
                <span className="settings-mode-title">{l.title}</span>
                <span className="settings-mode-body">{l.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {layout === "three_columns" && <RightColumnFields f={f} />}

      <div className="settings-field" id="nav-section-order">
        <div className="settings-field-label-row">
          <span className="form-label settings-field-label" id="nav-order-label">
            Section order
          </span>
          <HelpButton k="nav.section_order" label="Section order" />
        </div>
        <p className="form-hint">
          The order of the sections everywhere they appear: the sidebar, the tabs and More. Feed is always first. On a
          phone, the first four are the tabs on the bar at the bottom; the rest are under More.
        </p>
        <ol className="nav-order" aria-labelledby="nav-order-label">
          {sections.map((s, i) => (
            <li key={s.id} className="nav-order-row" data-section={s.id}>
              <span className="nav-order-place" aria-hidden="true">
                {i + 1}
              </span>
              <span className="nav-order-label">
                {s.label}
                {i < BAR_SECTION_COUNT && <span className="nav-order-bar">On the phone&apos;s bar</span>}
                {s.kind === "feed" && <span className="nav-order-fixed">Always first</span>}
              </span>
              {s.kind !== "feed" && (
                <span className="nav-order-moves">
                  <MoveButton
                    section={s}
                    by={-1}
                    disabled={f.disabled || i <= 1}
                    onMove={move}
                    refFor={(el) => buttons.current.set(`${s.id}:-1`, el)}
                  />
                  <MoveButton
                    section={s}
                    by={1}
                    disabled={f.disabled || i === sections.length - 1}
                    onMove={move}
                    refFor={(el) => buttons.current.set(`${s.id}:1`, el)}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="nav-order-preview">
          <span className="form-hint">The phone&apos;s bar: </span>
          {bar.map((s) => s.short).join(" · ")} · More
        </p>
        {stored && (
          <button
            type="button"
            className="admin-remove-section"
            onClick={() => f.set(ORDER_KEY, "")}
            disabled={f.disabled}
          >
            Use the default order
          </button>
        )}
      </div>

      <ClosingReminderField f={f} />
    </>
  );
}

const REMINDER_KEY = "feed.closing_reminder_hours";

/**
 * How long before a vote, proposal or conversation closes the feed says so
 * (Events 4): one value for every type, in hours or days, stored in hours.
 * Empty is the default, 48 hours; 0 turns the reminders off.
 */
function ClosingReminderField({ f }: { f: FormApi }) {
  const id = useId();
  const stored = f.value(REMINDER_KEY);
  const hours = stored.trim() === "" ? 48 : Number(stored);
  const inDays = Number.isInteger(hours) && hours > 0 && hours % 24 === 0;
  const unit: "days" | "hours" = inDays ? "days" : "hours";
  const amount = Number.isFinite(hours) ? (inDays ? hours / 24 : hours) : 48;
  const save = (n: number, u: "days" | "hours") => {
    const total = Math.max(0, Math.round(u === "days" ? n * 24 : n));
    f.set(REMINDER_KEY, String(Math.min(total, 336)));
  };
  return (
    <div className="settings-field" id="feed-closing-reminder-hours">
      <div className="settings-field-label-row">
        <label className="form-label settings-field-label" htmlFor={id}>
          Closing reminders in the feed
        </label>
        <HelpButton k={REMINDER_KEY} label="Closing reminders in the feed" />
      </div>
      <p className="form-hint">
        How long before a vote, proposal or conversation closes a reminder shows in the feed. The same for every kind.
        0 turns the reminders off; at most 14 days.
      </p>
      <span className="settings-number-row">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className="form-input"
          min={0}
          max={unit === "days" ? 14 : 336}
          step={1}
          value={amount}
          onChange={(e) => save(Number(e.target.value), unit)}
          disabled={f.disabled}
          style={{ maxWidth: "10ch" }}
        />
        <Select
          aria-label="Unit"
          value={unit}
          onChange={(e) => save(amount, e.target.value as "days" | "hours")}
          disabled={f.disabled}
          style={{ maxWidth: "14ch" }}
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </Select>
      </span>
      {stored && (
        <button type="button" className="admin-remove-section" onClick={() => f.set(REMINDER_KEY, "")} disabled={f.disabled}>
          Use the default (48 hours)
        </button>
      )}
    </div>
  );
}

/**
 * The right column's cards in the Three columns layout (ADR-019): each one
 * shown or hidden, in the hub's order. One setting, nav.aside_cards.
 */
function RightColumnFields({ f }: { f: FormApi }) {
  const stored = f.value(ASIDE_SETTING_KEY);
  const cards = asideCardsInOrder(stored);
  const save = (next: Array<{ id: string; shown: boolean }>) =>
    f.set(ASIDE_SETTING_KEY, JSON.stringify(withOrder(parseAsideCards(stored), next)));
  return (
    <div className="settings-field" id="nav-aside-cards">
      <div className="settings-field-label-row">
        <span className="form-label settings-field-label" id="nav-aside-label">
          Right column
        </span>
        <HelpButton k="nav.aside_cards" label="Right column" />
      </div>
      <p className="form-hint">
        The cards beside the feed and the section pages, top to bottom. Drag a card, or use Up and Down, to change the
        order. A card with nothing to show is left out on its own.
      </p>
      <SortableList
        label="Right column cards"
        disabled={f.disabled}
        items={cards.map((c) => ({
          id: c.id,
          name: c.card.name,
          extra: (
            <Switch
              label={<span className="visually-hidden">Show {c.card.name}</span>}
              checked={c.shown}
              disabled={f.disabled}
              onChange={(e) => save(cards.map((x) => ({ id: x.id, shown: x.id === c.id ? e.target.checked : x.shown })))}
            />
          ),
        }))}
        onChange={(ids) => save(ids.map((id) => ({ id, shown: cards.find((c) => c.id === id)!.shown })))}
      />
      {stored && (
        <button type="button" className="admin-remove-section" onClick={() => f.set(ASIDE_SETTING_KEY, "")} disabled={f.disabled}>
          Show every card in the default order
        </button>
      )}
    </div>
  );
}

function MoveButton({
  section,
  by,
  disabled,
  onMove,
  refFor,
}: {
  section: NavSection;
  by: -1 | 1;
  disabled: boolean;
  onMove: (id: string, by: -1 | 1) => void;
  refFor: (el: HTMLButtonElement | null) => void;
}) {
  const word = by < 0 ? "up" : "down";
  return (
    <button
      ref={refFor}
      type="button"
      className="nav-order-move"
      aria-label={`Move ${section.label} ${word}`}
      disabled={disabled}
      onClick={() => onMove(section.id, by)}
    >
      Move {word}
    </button>
  );
}
