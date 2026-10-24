// The config module (src/config/settings.ts, checkSettings.ts, env.ts;
// ADR-012): every setting declared once, checked at startup by name, never
// by value; the runbook's table generated from the declarations; the lint
// rule that keeps process.env inside src/config/env.ts.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";
import { assertSettings, checkSettings, settingsFailure } from "../../src/config/checkSettings.js";
import { SETTINGS } from "../../src/config/settings.js";
import { env, readSetting } from "../../src/config/env.js";
import { RUNBOOK, withTable } from "../../scripts/settings-doc.js";

const BASE = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k-secret-value" };
const PROD = {
  ...BASE,
  NODE_ENV: "production",
  CIVIC_ALLOWED_ORIGINS: "https://a.example",
  CIVIC_ANON_SECRET: "anon-secret-value",
  CRON_SECRET: "cron-secret-value",
  DIGEST_UNSUBSCRIBE_SECRET: "digest-secret-value-16",
};

describe("checkSettings", () => {
  it("passes a minimal development environment", () => {
    expect(checkSettings({ ...BASE })).toEqual({ missing: [], invalid: [], unknown: [] });
  });

  it("refuses a missing always-required setting by name", () => {
    const r = checkSettings({ SUPABASE_URL: BASE.SUPABASE_URL });
    expect(r.missing).toEqual([{ name: "SUPABASE_SERVICE_ROLE_KEY", reason: "always required" }]);
    expect(() => assertSettings({ SUPABASE_URL: BASE.SUPABASE_URL })).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
  });

  it("requires the production settings only in production", () => {
    expect(checkSettings({ ...BASE }).missing).toEqual([]);
    const r = checkSettings({ ...BASE, NODE_ENV: "production" });
    expect(r.missing.map((m) => m.name).sort()).toEqual(
      ["CIVIC_ALLOWED_ORIGINS", "CIVIC_ANON_SECRET", "CRON_SECRET", "DIGEST_UNSUBSCRIBE_SECRET"].sort(),
    );
    expect(checkSettings({ ...PROD }).missing).toEqual([]);
  });

  it("requires a conditional setting only when its switch is on", () => {
    expect(checkSettings({ ...BASE, CIVIC_HUB_MINTED_TOKEN: "false" }).missing).toEqual([]);
    expect(checkSettings({ ...BASE, CIVIC_HUB_MINTED_TOKEN: "true" }).missing.map((m) => m.name)).toEqual(["CIVIC_HUB_SIGNING_KEY"]);
    expect(checkSettings({ ...BASE, CIVIC_CONSOLE_HOSTNAME: "console.localhost" }).missing.map((m) => m.name)).toEqual([
      "CIVIC_CONSOLE_ADMIN_EMAIL",
    ]);
  });

  it("refuses a required setting of the wrong type by name, never quoting the value", () => {
    const r = checkSettings({ ...BASE, SUPABASE_URL: "not a url secretish" });
    expect(r.invalid).toEqual([{ name: "SUPABASE_URL", problem: "is not an http(s) URL", required: true }]);
    const msg = settingsFailure(r)!;
    expect(msg).toContain("SUPABASE_URL is not an http(s) URL");
    expect(msg).not.toContain("secretish");
  });

  it("reports an optional setting of the wrong type without refusing the start", () => {
    // Vitest itself sets BASE_URL=/ ; a stray value must not take the hubs down.
    const r = checkSettings({ ...BASE, PORT: "three-thousand-and-one", BASE_URL: "/" });
    expect(r.invalid.map((i) => [i.name, i.required])).toEqual([["PORT", false], ["BASE_URL", false]]);
    expect(settingsFailure(r)).toBeNull();
  });

  it("never prints a secret's value, set or missing", () => {
    const r = checkSettings({ ...PROD, CRON_SECRET: undefined, SUPABASE_URL: "x" });
    expect(settingsFailure(r)).toMatch(/CRON_SECRET/);
    expect(settingsFailure(r)).not.toMatch(/secret-value/);
  });

  it("reports an unknown setting that carries one of our prefixes, and ignores other variables", () => {
    const r = checkSettings({ ...BASE, CIVIC_ANON_SECRT: "typo", HOME: "/home/x", PATH: "/bin", VERCEL_URL: "x" });
    expect(r.unknown).toEqual(["CIVIC_ANON_SECRT"]);
    expect(settingsFailure(r)).toBeNull(); // reported, not refused
  });

  it("knows aliases, host names and hub-setting fallbacks", () => {
    const r = checkSettings({ ...BASE, SMTP_FROM: "a@b.c", VERCEL_GIT_COMMIT_SHA: "x", MEETING_SOURCE_URL: "https://x", CIVIC_ADMIN_EMAILS: "a@b.c" });
    expect(r.unknown).toEqual([]);
  });
});

describe("env reads", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads a host name first, then the setting, then its older aliases", () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.GIT_COMMIT_SHA = "own";
    expect(env.GIT_COMMIT_SHA).toBe("own");
    process.env.VERCEL_GIT_COMMIT_SHA = "host";
    expect(env.GIT_COMMIT_SHA).toBe("host");

    delete process.env.RESEND_FROM;
    process.env.SMTP_FROM = "older@example.test";
    expect(readSetting("RESEND_FROM")).toBe("older@example.test");
    process.env.RESEND_FROM = "newer@example.test";
    expect(readSetting("RESEND_FROM")).toBe("newer@example.test");
  });

  it("trims, and reads an empty value as unset", () => {
    process.env.CIVIC_DEV_HUB = "   ";
    expect(env.CIVIC_DEV_HUB).toBeUndefined();
    process.env.CIVIC_DEV_HUB = "  athens ";
    expect(env.CIVIC_DEV_HUB).toBe("athens");
  });

  it("declares every setting with a purpose and a layer", () => {
    for (const [name, d] of Object.entries(SETTINGS)) {
      expect(d.purpose.length, name).toBeGreaterThan(10);
      expect(["engine", "hosting", "dev"], name).toContain(d.layer);
    }
  });
});

describe("the settings reference", () => {
  it("RUNBOOK-operations.md's table is generated from the declarations and current", () => {
    const doc = readFileSync(RUNBOOK, "utf8");
    expect(withTable(doc), "run `npm run settings:doc`").toBe(doc);
  });
});

describe("process.env is read only in src/config/env.ts (lint)", () => {
  const ROOT = resolve(__dirname, "../..");
  const eslint = new ESLint({ cwd: ROOT });
  const errors = async (file: string, code: string) =>
    (await eslint.lintText(code, { filePath: resolve(ROOT, file) }))[0].messages.filter((m) => m.ruleId === "no-restricted-properties");

  it("refuses process.env in the engine, the hosting layer's callers and api/", async () => {
    expect(await errors("src/services/x.ts", "export const k = process.env.ANTHROPIC_API_KEY;")).toHaveLength(1);
    expect(await errors("src/modules/civic.vote/x.ts", "export const k = process.env.X;")).toHaveLength(1);
    expect(await errors("api/x.ts", "export const k = process.env.X;")).toHaveLength(1);
  });

  it("allows the one reader", async () => {
    expect(await errors("src/config/env.ts", "export const k = process.env.X;")).toHaveLength(0);
  });
});
