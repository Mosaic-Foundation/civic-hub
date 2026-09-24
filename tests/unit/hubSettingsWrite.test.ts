import { describe, expect, it } from "vitest";
import { validateSettingsWrite, normalizeValue } from "../../src/models/hubSettingsWrite.js";
import {
  EDITABLE_SETTING_KEYS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  fieldSpec,
} from "../../src/shared/hubSettingsSections.js";
import { KEYS, isPublicKey, isDocumentKey } from "../../src/models/hubSettings.js";

/**
 * What a hub admin may write from the Settings page, decided before anything
 * is stored. The endpoint stores exactly what validateSettingsWrite returns,
 * or nothing — so these are the rules, not a courtesy.
 */

describe("the editable-key table", () => {
  it("names only canonical keys", () => {
    const canonical = new Set<string>(Object.values(KEYS));
    for (const key of EDITABLE_SETTING_KEYS) {
      expect(canonical.has(key), `${key} is not in KEYS`).toBe(true);
    }
  });

  it("puts each key in exactly one section", () => {
    expect(new Set(EDITABLE_SETTING_KEYS).size).toBe(EDITABLE_SETTING_KEYS.length);
  });

  it("never offers the keys that have their own guarded endpoints", () => {
    for (const key of [
      KEYS.PEOPLE_ADMIN_EMAILS,
      KEYS.PEOPLE_BOARD_EMAILS,
      KEYS.EMAIL_FROM_ADDRESS,
      KEYS.BETA_ALLOWLIST,
    ]) {
      expect(EDITABLE_SETTING_KEYS).not.toContain(key);
    }
  });

  it("marks every document-sized key as a document", () => {
    for (const key of EDITABLE_SETTING_KEYS) {
      if (isDocumentKey(key)) expect(fieldSpec(key)?.kind).toBe("document");
    }
  });

  it("adds the logo to the public subset and nothing else from this table", () => {
    expect(isPublicKey(KEYS.IDENTITY_LOGO_URL)).toBe(true);
    for (const key of [
      KEYS.EMAIL_FROM_NAME,
      KEYS.EMAIL_POSTAL_ADDRESS,
      KEYS.PLUGIN_DIGEST_SEND_HOUR,
    ]) {
      expect(isPublicKey(key), key).toBe(false);
    }
  });
});

describe("validateSettingsWrite", () => {
  it("accepts a section's own keys and returns them normalised", () => {
    const r = validateSettingsWrite("identity", {
      "identity.name": "  Test Hub  ",
      "identity.theme": "#1F5F8B",
    });
    expect(r).toEqual({
      ok: true,
      section: "identity",
      entries: [
        { key: "identity.name", value: "Test Hub" },
        { key: "identity.theme", value: "#1f5f8b" },
      ],
    });
  });

  it("refuses an unknown key by name, and saves nothing", () => {
    const r = validateSettingsWrite("identity", {
      "identity.name": "Fine",
      "identity.nickname": "Not a key",
      "people.admin_emails": "[]",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unknownKeys).toEqual(["identity.nickname", "people.admin_emails"]);
    expect(r.error).toMatch(/Nothing was saved/);
  });

  it("refuses a known key sent with another section", () => {
    const r = validateSettingsWrite("identity", { "legal.operator_name": "Someone" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in the identity section/);
  });

  it("refuses an unknown section and an empty write", () => {
    expect(validateSettingsWrite("people", { "identity.name": "x" }).ok).toBe(false);
    expect(validateSettingsWrite("identity", {}).ok).toBe(false);
    expect(validateSettingsWrite("identity", ["identity.name"]).ok).toBe(false);
  });

  it("is all or nothing: one bad value refuses the whole write", () => {
    const r = validateSettingsWrite("legal", {
      "legal.operator_name": "A Committee",
      "legal.contact_email": "not an address",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts every section's full key set", () => {
    for (const id of SETTINGS_SECTION_IDS) {
      const values: Record<string, unknown> = {};
      for (const spec of SETTINGS_SECTIONS[id]) {
        values[spec.key] =
          spec.kind === "boolean" ? true : spec.kind === "hour" ? 7 : "";
      }
      const r = validateSettingsWrite(id, values);
      expect(r.ok, `${id}: ${r.ok ? "" : r.error}`).toBe(true);
    }
  });
});

describe("normalizeValue by kind", () => {
  const spec = (key: string) => fieldSpec(key)!;

  it("keeps empty strings — they return the hub to its default", () => {
    expect(normalizeValue(spec("identity.tagline"), "   ")).toBe("");
    expect(normalizeValue(spec("identity.banner_url"), "")).toBe("");
    expect(normalizeValue(spec("legal.terms"), "")).toBe("");
  });

  it("text is one line and length-checked", () => {
    expect(normalizeValue(spec("identity.name"), "Two\nlines")).toEqual({
      error: "identity.name must be one line.",
    });
    expect(normalizeValue(spec("identity.label"), "x".repeat(41))).toHaveProperty("error");
  });

  it("documents are trimmed and end in one newline", () => {
    expect(normalizeValue(spec("legal.code_of_conduct"), "\r\n# Code\r\n\r\nBe kind.\r\n\n")).toBe(
      "# Code\n\nBe kind.\n",
    );
  });

  it("emails are lowercased and shape-checked", () => {
    expect(normalizeValue(spec("legal.contact_email"), " Ops@Example.COM ")).toBe("ops@example.com");
    expect(normalizeValue(spec("legal.contact_email"), "ops at example")).toHaveProperty("error");
  });

  it("colours are #rrggbb only", () => {
    expect(normalizeValue(spec("identity.theme"), "#ABCDEF")).toBe("#abcdef");
    for (const bad of ["red", "#abc", "abcdef", "#abcdeg"]) {
      expect(normalizeValue(spec("identity.theme"), bad), bad).toHaveProperty("error");
    }
  });

  it("images are an http(s) URL or a root-relative path, nothing else", () => {
    const k = spec("identity.logo_url");
    expect(normalizeValue(k, "https://cdn.example.com/hubs/x/logo.webp")).toBe(
      "https://cdn.example.com/hubs/x/logo.webp",
    );
    expect(normalizeValue(k, "/banner.jpg")).toBe("/banner.jpg");
    for (const bad of ["javascript:alert(1)", "//evil.example/x.png", "data:image/png;base64,AAAA", "logo.png"]) {
      expect(normalizeValue(k, bad), bad).toHaveProperty("error");
    }
  });

  it("booleans are true/false and always stored", () => {
    const k = spec("plugin.digest.enabled");
    expect(normalizeValue(k, true)).toBe("true");
    expect(normalizeValue(k, "false")).toBe("false");
    expect(normalizeValue(k, "")).toHaveProperty("error");
    expect(normalizeValue(k, "yes")).toHaveProperty("error");
  });

  it("the send hour is a whole hour, 0 to 23", () => {
    const k = spec("plugin.digest.send_hour");
    expect(normalizeValue(k, 0)).toBe("0");
    expect(normalizeValue(k, "23")).toBe("23");
    for (const bad of [24, -1, 7.5, "", "noon"]) {
      expect(normalizeValue(k, bad), String(bad)).toHaveProperty("error");
    }
  });

  it("a non-string for a string kind is refused, not coerced", () => {
    expect(normalizeValue(spec("identity.name"), 42)).toHaveProperty("error");
    expect(normalizeValue(spec("legal.terms"), null)).toHaveProperty("error");
  });
});
