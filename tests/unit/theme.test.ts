import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_COLORS,
  THEME_PRESETS,
  THEME_TYPE_KEYS,
  TEXT_CONTRAST,
  UI_CONTRAST,
  contrast,
  parseTheme,
  previewVars,
  resolveTheme,
  serializeTheme,
  typePair,
  validateThemeValue,
} from "../../src/shared/theme.js";

/**
 * A hub's theme: what an admin picks, what it becomes, and the readability
 * rules no pick can break.
 */

describe("parse and serialize", () => {
  it("reads nothing as no theme, and today's single hex as primary", () => {
    expect(parseTheme("")).toEqual({});
    expect(parseTheme(undefined)).toEqual({});
    expect(parseTheme("#2A6F4E")).toEqual({ primary: "#2a6f4e" });
  });

  it("drops unknown or invalid fields rather than failing", () => {
    expect(
      parseTheme(
        JSON.stringify({
          primary: "#123456",
          accent: "orange",
          preset: "nope",
          types: { vote: "#abcdef", unicorn: "#000000" },
          fonts: "Comic Sans",
        }),
      ),
    ).toEqual({ primary: "#123456", types: { vote: "#abcdef" } });
    expect(parseTheme("{not json")).toEqual({});
  });

  it("serializes canonically, and an empty or default theme as nothing", () => {
    expect(serializeTheme({})).toBe("");
    expect(serializeTheme({ preset: "default" })).toBe("");
    expect(serializeTheme({ types: { proposal: "#5F4B8B" }, primary: "#2A4E84" })).toBe(
      '{"primary":"#2a4e84","types":{"proposal":"#5f4b8b"}}',
    );
    const t = { preset: "forest", accent: "#b7791f", types: { brief: "#8c4a2b" } };
    expect(parseTheme(serializeTheme(t))).toEqual(t);
  });
});

describe("validateThemeValue", () => {
  it("accepts an object, its JSON, a bare hex and empty", () => {
    expect(validateThemeValue({ primary: "#1D4F91" })).toEqual({ value: '{"primary":"#1d4f91"}' });
    expect(validateThemeValue('{"preset":"brick"}')).toEqual({ value: '{"preset":"brick"}' });
    expect(validateThemeValue("#1d4f91")).toEqual({ value: '{"primary":"#1d4f91"}' });
    expect(validateThemeValue("")).toEqual({ value: "" });
  });

  it("refuses what is present but wrong, instead of saving it as no theme", () => {
    for (const bad of [
      "blue",
      "{bad json",
      { primary: "blue" },
      { preset: "neon" },
      { types: { unicorn: "#000000" } },
      { types: { vote: "red" } },
      { types: ["#000000"] },
      42,
    ]) {
      expect(validateThemeValue(bad), JSON.stringify(bad)).toHaveProperty("error");
    }
  });
});

describe("resolveTheme", () => {
  it("emits nothing for the default palette, so the stylesheet stands as it is", () => {
    const r = resolveTheme({});
    expect(r.vars).toEqual({});
    expect(r.adjustments).toEqual([]);
    expect(resolveTheme({ preset: "default" }).vars).toEqual({});
  });

  it("builds the primary scale around the chosen colour", () => {
    const r = resolveTheme({ primary: "#1f6f6b" });
    expect(r.vars["--ds-color-primary-600"]).toBe("#1f6f6b");
    expect(Object.keys(r.vars).filter((k) => k.startsWith("--ds-color-primary-"))).toHaveLength(10);
    // Votes follow primary, as they do by default.
    expect(r.vars["--type-vote-fg"]).toBeUndefined();
    expect(r.effective.types.vote).not.toBe(DEFAULT_THEME_COLORS.types.vote);
  });

  it("darkens a primary too light for white button text, and says so", () => {
    const r = resolveTheme({ primary: "#9fd3ff" });
    expect(contrast(r.effective.primary, "#ffffff")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0]).toMatchObject({ what: "Primary", from: "#9fd3ff" });
  });

  it("keeps the accent CTA label readable and the page's grey text readable", () => {
    const r = resolveTheme({ accent: "#ffd966", background: "#b0b0b0" });
    expect(contrast(r.effective.accent, "#ffffff")).toBeGreaterThanOrEqual(UI_CONTRAST);
    expect(contrast(r.effective.background, "#5e6e88")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(r.adjustments.map((a) => a.what).sort()).toEqual(["Accent", "Background"]);
  });

  it("gives a process type one hue as a dark edge and a light pill", () => {
    const r = resolveTheme({ types: { conversation: "#40c4c0" } });
    const fg = r.vars["--type-conversation-fg"]!;
    const bg = r.vars["--type-conversation-bg"]!;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(fg, "#ffffff")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(r.vars["--pill-conversation-fg"]).toBe(fg);
    expect(r.adjustments[0]).toMatchObject({ what: "Conversations" });
  });

  it("leaves the general control accent alone when votes get their own hue", () => {
    const r = resolveTheme({ types: { vote: "#8b1e3f" } });
    expect(r.vars["--type-vote-fg"]).toBeDefined();
    expect(r.vars["--pill-vote-fg"]).toBeUndefined();
  });

  it("every type pair passes for any hue, light or dark", () => {
    for (const hue of ["#ffffff", "#ffff00", "#00ff00", "#000000", "#777777", "#ff00ff", "#e0e0ff"]) {
      const { fg, bg } = typePair(hue);
      expect(contrast(fg, bg), hue).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  });

  it("ships presets that need no adjustment", () => {
    for (const preset of THEME_PRESETS) {
      const r = resolveTheme({ preset: preset.id });
      expect(r.adjustments, preset.id).toEqual([]);
    }
  });

  it("the default palette's own pairs pass the same rules", () => {
    expect(contrast(DEFAULT_THEME_COLORS.primary, "#ffffff")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(DEFAULT_THEME_COLORS.accent, "#ffffff")).toBeGreaterThanOrEqual(UI_CONTRAST);
    for (const key of THEME_TYPE_KEYS) {
      expect(contrast(DEFAULT_THEME_COLORS.types[key], "#ffffff"), key).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  });
});

describe("previewVars", () => {
  it("fills every themable primitive, so a preview never inherits the live theme", () => {
    const empty = previewVars(resolveTheme({}));
    expect(empty["--ds-color-primary-600"]).toBe("#2a4e84");
    expect(empty["--ds-color-action-primary"]).toBe("#2a4e84");
    expect(empty["--ds-color-bg-page"]).toBe("#f8f6f3");

    const teal = previewVars(resolveTheme({ preset: "harbor-teal" }));
    expect(teal["--ds-color-primary-600"]).toBe("#1f6f6b");
    expect(teal["--ds-color-action-primary"]).toBe("#1f6f6b");
    expect(teal["--ds-color-action-accent"]).toBe("#c0582b");
  });

  it("the default scale values match what the design system ships", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("ui/src/styles/design-system/tokens.css", "utf-8").toLowerCase();
    const empty = previewVars(resolveTheme({}));
    for (const [name, value] of Object.entries(empty)) {
      const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`));
      if (m) expect(value, name).toBe(m[1]);
    }
  });
});
