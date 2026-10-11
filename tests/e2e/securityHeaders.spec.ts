/**
 * Audit 2, A8 (2026-10-11): the pages work under the security headers.
 *
 * Visits the hub's pages (lists, one detail page of each kind the hub has,
 * an admin's Settings), the console and the start page, and fails on any
 * Content Security Policy violation the browser reports, and on a page that
 * renders nothing.
 *
 * Needs the UI as a production build behind `vite preview`, which serves the
 * headers from src/shared/securityHeaders.ts (the dev server cannot: Vite's
 * dev client needs inline scripts). TESTING.md has the commands. Against the
 * dev server the spec skips, saying so.
 */

import { test, expect, type Page } from "@playwright/test";
import { E2E_API_BASE } from "./hubApi.js";
import { mintSession } from "../fixtures/adminSession.js";
import { CONTENT_SECURITY_POLICY } from "../../src/shared/securityHeaders.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const at = (host: string, path: string) => `${UI.protocol}//${host}${UI.port ? `:${UI.port}` : ""}${path}`;

/** Record every CSP violation the page reports, from before its first script. */
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(msg.text())) seen.push(msg.text());
  });
  await page.exposeFunction("__cspViolation", (v: string) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(
        `${e.violatedDirective} blocked ${e.blockedURI || "(inline)"} on ${location.pathname}`,
      );
    });
  });
  return seen;
}

/** Ids of one process of each kind the dev hub has, for its detail page. */
async function detailPaths(): Promise<string[]> {
  const res = await fetch(`${E2E_API_BASE}/process`);
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : ((body as { processes?: unknown[] }).processes ?? [])) as Array<{
    id: string;
    type: string;
  }>;
  const route: Record<string, string> = {
    "civic.vote": "/process/",
    "civic.proposal": "/proposal/",
    "civic.project": "/project/",
    "civic.polis_deliberation": "/deliberation/",
    "civic.brief": "/brief/",
    "civic.meeting_summary": "/meeting-summary/",
    "civic.announcement": "/announcement/",
    "civic.wordcloud": "/wordcloud/",
  };
  const out: string[] = [];
  for (const [type, prefix] of Object.entries(route)) {
    const p = list.find((x) => x.type === type);
    if (p) out.push(`${prefix}${encodeURIComponent(p.id)}`);
  }
  return out;
}

test("every page works under the Content Security Policy", async ({ page }) => {
  test.setTimeout(180_000);
  const first = await page.goto("/");
  const csp = first?.headers()["content-security-policy"];
  test.skip(!csp, "The UI is not served with the security headers: run against a production build behind vite preview (TESTING.md).");
  expect(csp).toBe(CONTENT_SECURITY_POLICY);
  expect(first?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first?.headers()["strict-transport-security"]).toMatch(/max-age=/);

  const violations = await watchViolations(page);
  const lists = ["/", "/votes", "/propose", "/projects", "/deliberations", "/outcomes", "/about", "/search?q=vote", "/privacy"];
  for (const path of [...lists, ...(await detailPaths())]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#root"), path).not.toBeEmpty();
  }

  // An admin's Settings, signed in with a minted session.
  const token = await mintSession("athens", "admin+athens@example.test");
  await page.addInitScript((t) => localStorage.setItem("civic_auth_token", t), token);
  for (const path of ["/admin/settings", "/admin/settings/plugins", "/admin/reviews"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#root"), path).not.toBeEmpty();
  }

  expect(violations, violations.join("\n")).toEqual([]);
});

test("the console and the start page work under it too", async ({ page }) => {
  const consoleRes = await page.goto(at("console.localhost", "/console.html"));
  test.skip(!consoleRes?.headers()["content-security-policy"], "Not served with the security headers (see above).");
  const violations = await watchViolations(page);
  await page.goto(at("console.localhost", "/console.html"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toBeEmpty();
  await page.goto(at("start.localhost", "/start.html"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(violations, violations.join("\n")).toEqual([]);
});
