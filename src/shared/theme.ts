// A hub's colour theme: what an admin picks, and every CSS token it becomes.
//
// Shared by the server (which validates and stores `identity.theme`) and the
// UI (which applies it at boot and previews it in Settings → Theme). Pure: no
// DOM, no request, so the rules that keep a theme readable are unit-tested.
//
// DESIGN RULES THAT ARE NOT CHOICES (Adam, 2026-09-24):
//   - An admin picks a handful of colours, never individual tokens. Every
//     scale, hover shade and pill pair is derived from them.
//   - A process type is ONE hue. Its dark edge (card border, pill text) and
//     its light pill background are derived from it, so the pair always
//     matches the way the default palette's pairs do.
//   - Readability is enforced by adjusting, not by refusing: a colour that
//     would fail contrast is darkened or lightened just enough to pass, and
//     the adjustment is reported so the admin sees the colour actually used.
//   - Light mode only in v1. Nothing here assumes it, but nothing offers dark.
//
// STORAGE: `identity.theme` holds serializeTheme()'s JSON. A bare "#rrggbb"
// (what part five stored) still parses, as { primary }.

export const THEME_TYPE_KEYS = [
  "vote",
  "proposal",
  "conversation",
  "project",
  "announcement",
  "meeting",
  "brief",
  "wordcloud",
] as const;
export type ThemeTypeKey = (typeof THEME_TYPE_KEYS)[number];

export interface HubTheme {
  /** A preset id; its colours apply first, then the fields below. */
  preset?: string;
  primary?: string;
  accent?: string;
  background?: string;
  types?: Partial<Record<ThemeTypeKey, string>>;
}

export interface ThemePreset {
  id: string;
  label: string;
  primary?: string;
  accent?: string;
  background?: string;
}

/**
 * "Default" is today's palette exactly: it sets nothing, so the design
 * system's own values stand. The others set the three base colours and leave
 * each process type on its default hue, which follows primary (votes, the
 * generic pill) or accent (announcements, briefs) where the default does.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "default", label: "Default" },
  { id: "civic-blue", label: "Civic Blue", primary: "#1d4f91", accent: "#d17a22", background: "#f5f7fb" },
  { id: "forest", label: "Forest", primary: "#2f6b3a", accent: "#b7791f", background: "#f6f7f2" },
  { id: "harbor-teal", label: "Harbor Teal", primary: "#1f6f6b", accent: "#c0582b", background: "#f3f8f7" },
  { id: "brick", label: "Brick", primary: "#9a3b2a", accent: "#3b6e8f", background: "#faf6f2" },
];

/** Today's values, for swatches and as the base a partial theme builds on. */
export const DEFAULT_THEME_COLORS = {
  primary: "#2a4e84",
  accent: "#c37b51",
  background: "#f8f6f3",
  types: {
    vote: "#15294c",
    proposal: "#5f4b8b",
    conversation: "#0f5e66",
    project: "#1565c0",
    announcement: "#8c4a2b",
    meeting: "#2a7340",
    brief: "#8c4a2b",
    wordcloud: "#5c6b2a",
  } as Record<ThemeTypeKey, string>,
};

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value.trim().toLowerCase());
}

// --- parse / serialize -------------------------------------------------------

/**
 * A stored value as a theme. Never throws: "" is no theme, a bare hex is the
 * part-five single colour, and anything unreadable or unknown is dropped
 * field by field, because a bad row must not take the site's styling down.
 */
export function parseTheme(raw: string | undefined | null): HubTheme {
  const text = raw?.trim() ?? "";
  if (text === "") return {};
  if (isHexColor(text)) return { primary: text.toLowerCase() };
  try {
    return cleanTheme(JSON.parse(text));
  } catch {
    return {};
  }
}

/** Keep only known fields with valid values. */
export function cleanTheme(input: unknown): HubTheme {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: HubTheme = {};
  if (typeof src.preset === "string" && THEME_PRESETS.some((p) => p.id === src.preset)) {
    out.preset = src.preset;
  }
  for (const k of ["primary", "accent", "background"] as const) {
    if (isHexColor(src[k])) out[k] = (src[k] as string).toLowerCase();
  }
  if (src.types && typeof src.types === "object" && !Array.isArray(src.types)) {
    const types: Partial<Record<ThemeTypeKey, string>> = {};
    for (const k of THEME_TYPE_KEYS) {
      const v = (src.types as Record<string, unknown>)[k];
      if (isHexColor(v)) types[k] = v.toLowerCase();
    }
    if (Object.keys(types).length > 0) out.types = types;
  }
  return out;
}

/** Canonical JSON, keys in a fixed order, or "" for no theme at all. */
export function serializeTheme(theme: HubTheme): string {
  const t = cleanTheme(theme);
  const out: Record<string, unknown> = {};
  if (t.preset && t.preset !== "default") out.preset = t.preset;
  for (const k of ["primary", "accent", "background"] as const) if (t[k]) out[k] = t[k];
  if (t.types) {
    const types: Record<string, string> = {};
    for (const k of THEME_TYPE_KEYS) if (t.types[k]) types[k] = t.types[k]!;
    if (Object.keys(types).length > 0) out.types = types;
  }
  return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}

/**
 * Validate an admin's write. Accepts a theme object or its JSON (or a bare
 * hex). Refuses a value that is present but not a theme — a typo must not be
 * silently saved as "no theme".
 */
export function validateThemeValue(raw: unknown): { value: string } | { error: string } {
  let input: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return { value: "" };
    if (isHexColor(text)) return { value: serializeTheme({ primary: text }) };
    try {
      input = JSON.parse(text);
    } catch {
      return { error: "identity.theme must be a theme object." };
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "identity.theme must be a theme object." };
  }
  const src = input as Record<string, unknown>;
  for (const k of ["primary", "accent", "background"]) {
    if (src[k] !== undefined && src[k] !== "" && !isHexColor(src[k])) {
      return { error: `Theme ${k} must be a colour like #1f5f8b.` };
    }
  }
  if (src.preset !== undefined && !THEME_PRESETS.some((p) => p.id === src.preset)) {
    return { error: `Unknown theme preset "${String(src.preset)}".` };
  }
  if (src.types !== undefined) {
    if (!src.types || typeof src.types !== "object" || Array.isArray(src.types)) {
      return { error: "Theme types must be an object." };
    }
    for (const [k, v] of Object.entries(src.types as Record<string, unknown>)) {
      if (!(THEME_TYPE_KEYS as readonly string[]).includes(k)) {
        return { error: `Unknown process type in theme: ${k}.` };
      }
      if (v !== "" && !isHexColor(v)) return { error: `Theme colour for ${k} must be like #1f5f8b.` };
    }
  }
  return { value: serializeTheme(cleanTheme(input)) };
}

// --- colour maths --------------------------------------------------------------

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `amount` (0–1) of the way from `a` to `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amount) as Rgb);
}

const WHITE = "#ffffff";
const BLACK = "#000000";

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Move `color` towards `toward` in small steps until it reaches `ratio` against `against`. */
function adjustFor(color: string, against: string, ratio: number, toward: string): string {
  let c = color;
  for (let i = 0; i < 40 && contrast(c, against) < ratio; i++) c = mix(c, toward, 0.06);
  return c;
}

// --- derivations -----------------------------------------------------------------

/** Text contrast for body-size text (WCAG AA). */
export const TEXT_CONTRAST = 4.5;
/** Bold button labels and non-text edges (WCAG AA large text / UI components). */
export const UI_CONTRAST = 3;

export interface ThemeAdjustment {
  /** What was adjusted, in words the admin reads: "Primary", "Proposal". */
  what: string;
  from: string;
  to: string;
  why: string;
}

export interface ResolvedTheme {
  /** CSS custom properties to set, name → value. Empty for the default palette. */
  vars: Record<string, string>;
  adjustments: ThemeAdjustment[];
  /** The colours in effect after presets and adjustment, for swatches. */
  effective: { primary: string; accent: string; background: string; types: Record<ThemeTypeKey, string> };
}

/** A 50–950 scale with `seed` as the 600 step, the design system's layout. */
function scale(seed: string): Record<string, string> {
  return {
    "50": mix(seed, WHITE, 0.92),
    "100": mix(seed, WHITE, 0.84),
    "200": mix(seed, WHITE, 0.68),
    "300": mix(seed, WHITE, 0.48),
    "400": mix(seed, WHITE, 0.28),
    "500": mix(seed, WHITE, 0.12),
    "600": seed,
    "700": mix(seed, BLACK, 0.22),
    "800": mix(seed, BLACK, 0.4),
    "950": mix(seed, BLACK, 0.62),
  };
}

/**
 * A process type's pair from one hue: a light pill background and a dark
 * edge/text colour that reads on it (and on white, since the edge sits on a
 * white card).
 */
export function typePair(hue: string): { fg: string; bg: string } {
  const bg = mix(hue, WHITE, 0.86);
  let fg = hue;
  fg = adjustFor(fg, bg, TEXT_CONTRAST, BLACK);
  fg = adjustFor(fg, WHITE, TEXT_CONTRAST, BLACK);
  return { fg, bg };
}

const TYPE_LABELS: Record<ThemeTypeKey, string> = {
  vote: "Votes",
  proposal: "Proposals",
  conversation: "Conversations",
  project: "Projects",
  announcement: "Announcements",
  meeting: "Meeting summaries",
  brief: "Civic briefs",
  wordcloud: "Word clouds",
};

export function themeTypeLabel(key: ThemeTypeKey): string {
  return TYPE_LABELS[key];
}

/**
 * The legacy --pill-* names a type also drives, so older surfaces follow.
 * Not vote: --pill-vote-* doubles as the general control accent (~25 sites
 * in App.css), which should follow primary, not the votes hue.
 */
const LEGACY_PILLS: Partial<Record<ThemeTypeKey, string[]>> = {
  proposal: ["proposal"],
  conversation: ["conversation"],
  project: ["project"],
  wordcloud: ["wordcloud"],
  announcement: ["announcement"],
  meeting: ["meeting"],
  brief: ["brief"],
};

/**
 * Everything a theme sets. Only what the admin (or the preset) chose is
 * emitted, so an empty theme emits nothing and the stylesheet's own values —
 * today's palette, byte for byte — stand.
 */
export function resolveTheme(theme: HubTheme): ResolvedTheme {
  const preset = THEME_PRESETS.find((p) => p.id === theme.preset);
  const chosen = {
    primary: theme.primary ?? preset?.primary,
    accent: theme.accent ?? preset?.accent,
    background: theme.background ?? preset?.background,
  };
  const vars: Record<string, string> = {};
  const adjustments: ThemeAdjustment[] = [];

  let primary = DEFAULT_THEME_COLORS.primary;
  if (chosen.primary) {
    primary = adjustFor(chosen.primary, WHITE, TEXT_CONTRAST, BLACK);
    if (primary !== chosen.primary) {
      adjustments.push({
        what: "Primary",
        from: chosen.primary,
        to: primary,
        why: "darkened so white text on buttons stays readable",
      });
    }
    for (const [step, v] of Object.entries(scale(primary))) vars[`--ds-color-primary-${step}`] = v;
  }

  let accent = DEFAULT_THEME_COLORS.accent;
  if (chosen.accent) {
    accent = adjustFor(chosen.accent, WHITE, UI_CONTRAST, BLACK);
    if (accent !== chosen.accent) {
      adjustments.push({
        what: "Accent",
        from: chosen.accent,
        to: accent,
        why: "darkened so the bold label on accent buttons stays readable",
      });
    }
    for (const [step, v] of Object.entries(scale(accent))) {
      if (step !== "950") vars[`--ds-color-accent-${step}`] = v;
    }
  }

  let background = DEFAULT_THEME_COLORS.background;
  if (chosen.background) {
    // Muted text (the lightest text the site uses) must still read on it.
    background = adjustFor(chosen.background, "#5e6e88", TEXT_CONTRAST, WHITE);
    if (background !== chosen.background) {
      adjustments.push({
        what: "Background",
        from: chosen.background,
        to: background,
        why: "lightened so grey text on the page stays readable",
      });
    }
    vars["--ds-color-paper-50"] = background;
    vars["--ds-color-paper-100"] = mix(background, BLACK, 0.025);
    vars["--ds-color-paper-200"] = mix(background, BLACK, 0.07);
  }

  // A type follows the base colour it follows by default (vote → primary,
  // announcement and brief → accent) unless the admin picked its own hue.
  const types = { ...DEFAULT_THEME_COLORS.types };
  if (chosen.primary) types.vote = mix(primary, BLACK, 0.4);
  if (chosen.accent) {
    types.announcement = mix(accent, BLACK, 0.4);
    types.brief = mix(accent, BLACK, 0.4);
  }
  for (const key of THEME_TYPE_KEYS) {
    const picked = theme.types?.[key];
    if (!picked) continue;
    const { fg, bg } = typePair(picked);
    types[key] = fg;
    if (fg !== picked) {
      adjustments.push({
        what: TYPE_LABELS[key],
        from: picked,
        to: fg,
        why: "darkened so the pill text and card edge stay readable",
      });
    }
    vars[`--type-${key}-fg`] = fg;
    vars[`--type-${key}-bg`] = bg;
    for (const pill of LEGACY_PILLS[key] ?? []) {
      vars[`--pill-${pill}-fg`] = fg;
      vars[`--pill-${pill}-bg`] = bg;
    }
    if (key === "brief") {
      vars["--type-brief-rule"] = mix(fg, WHITE, 0.35);
      vars["--type-brief-wash"] = mix(picked, WHITE, 0.94);
    }
  }

  // The design system's own aliases that point at a themed step. At :root
  // they would re-resolve anyway; emitting them too is what lets the same
  // variables theme a preview box (a `.theme-scope` element), where an alias
  // inherited from :root has already been computed from the default palette.
  for (const [alias, target] of DS_ALIASES) {
    if (vars[target] !== undefined) vars[alias] = vars[target]!;
  }

  return {
    vars,
    adjustments,
    effective: { primary, accent, background, types },
  };
}

/** Design-system alias → the primitive it names (design-system/tokens.css). */
const DS_ALIASES: ReadonlyArray<[string, string]> = [
  ["--ds-color-bg-page", "--ds-color-paper-50"],
  ["--ds-color-bg-surface-alt", "--ds-color-paper-100"],
  ["--ds-color-text-link", "--ds-color-primary-600"],
  ["--ds-color-text-link-hover", "--ds-color-primary-700"],
  ["--ds-color-border-focus", "--ds-color-primary-500"],
  ["--ds-color-action-primary", "--ds-color-primary-600"],
  ["--ds-color-action-primary-hover", "--ds-color-primary-700"],
  ["--ds-color-action-primary-active", "--ds-color-primary-800"],
  ["--ds-color-action-accent", "--ds-color-accent-600"],
  ["--ds-color-action-accent-hover", "--ds-color-accent-700"],
  ["--ds-color-action-accent-active", "--ds-color-accent-800"],
  ["--ds-color-info-700", "--ds-color-primary-700"],
  ["--ds-color-info-500", "--ds-color-primary-500"],
  ["--ds-color-info-100", "--ds-color-primary-100"],
];

/**
 * The design system's own values for every primitive a theme can set, as in
 * ui/src/styles/design-system/tokens.css. Used only to preview a theme inside
 * a page that already wears a different one: the preview must start from the
 * defaults, not inherit the live theme wherever the draft sets nothing.
 */
const DS_DEFAULTS: Readonly<Record<string, string>> = {
  "--ds-color-paper-50": "#f8f6f3",
  "--ds-color-paper-100": "#f4f1ea",
  "--ds-color-paper-200": "#e8e2d4",
  "--ds-color-primary-50": "#ecf1fa",
  "--ds-color-primary-100": "#dce5f2",
  "--ds-color-primary-200": "#b9cade",
  "--ds-color-primary-300": "#8faace",
  "--ds-color-primary-400": "#5b82b8",
  "--ds-color-primary-500": "#3e66a0",
  "--ds-color-primary-600": "#2a4e84",
  "--ds-color-primary-700": "#1f3a66",
  "--ds-color-primary-800": "#15294c",
  "--ds-color-primary-950": "#0e1e36",
  "--ds-color-accent-50": "#faf0e7",
  "--ds-color-accent-100": "#f4e1d2",
  "--ds-color-accent-200": "#efd3be",
  "--ds-color-accent-300": "#e8c2a8",
  "--ds-color-accent-400": "#ddae8e",
  "--ds-color-accent-500": "#d69a75",
  "--ds-color-accent-600": "#c37b51",
  "--ds-color-accent-700": "#a85d38",
  "--ds-color-accent-800": "#8c4a2b",
};

/**
 * Every themable primitive and alias, defaults filled in where the theme
 * sets nothing — for an element that must show exactly this theme (the
 * preview), not this theme on top of whatever the page wears.
 */
export function previewVars(resolved: ResolvedTheme): Record<string, string> {
  const out: Record<string, string> = { ...DS_DEFAULTS };
  for (const [alias, target] of DS_ALIASES) out[alias] = DS_DEFAULTS[target] ?? out[alias]!;
  return { ...out, ...resolved.vars };
}
