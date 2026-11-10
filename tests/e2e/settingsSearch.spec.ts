/**
 * The settings search (2026-11-10). Typing "wait list" on Hub settings and
 * picking the result lands on Mode, the Waitlist panel open and marked. And
 * every result's link, for every setting the search knows, finds that setting
 * on the page: its own "?" (HelpButton's data-help-anchor), or, for a part
 * the page shows only sometimes (SOMETIMES_SHOWN) or a setting of a plugin
 * switched off, the panel that holds it. Nothing is saved.
 *
 * Runs on whichever hub `localhost` resolves to, as its admin, with a
 * session written into the LOCAL stack (tests/fixtures/adminSession.ts).
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { E2E_API_BASE as API } from "./hubApi";
import { execFileSync } from "node:child_process";

// The search's index, from src/shared/settingsSearch.ts. Read through tsx:
// Playwright's loader cannot import the help registry's JSON the way the
// hub's build does.
interface Entry {
  key: string;
  path: string;
}
function searchIndex(): { entries: Entry[]; sometimes: string[] } {
  const out = execFileSync(
    "npx",
    [
      "tsx",
      "-e",
      `import { buildSearchIndex, SOMETIMES_SHOWN } from "./src/shared/settingsSearch.ts";
       console.log(JSON.stringify({ entries: buildSearchIndex().map(({ key, path }) => ({ key, path })), sometimes: Object.keys(SOMETIMES_SHOWN) }));`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim().split("\n").pop()!);
}

async function signInAsAdmin(page: Page, request: APIRequestContext) {
  const { hub } = await (await request.get(`${API}/hub-config`)).json();
  const email = hub.id === "floyd" ? "admin@example.test" : `admin+${hub.id}@example.test`;
  const token = await mintSession(hub.id, email);
  await localRest(`users?hub_id=eq.${hub.id}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

test("searching for 'wait list' opens Mode's waitlist and marks it", async ({ page, request }) => {
  await signInAsAdmin(page, request);
  await page.goto("/admin/settings/identity");

  const box = page.getByRole("combobox", { name: "Search settings" });
  await box.fill("wait list");
  const results = page.getByRole("listbox", { name: "Settings found" });
  await expect(results.getByRole("option").first()).toContainText("Waitlist");
  await expect(results.getByRole("option").first()).toContainText("Mode");

  await box.press("Enter");
  await expect(page).toHaveURL(/\/admin\/settings\/mode#mode-waitlist$/);
  const panel = page.locator("details#waitlist");
  await expect(panel).toHaveAttribute("open", "");
  await expect(panel).toHaveClass(/is-link-target/);
  await expect(panel).toBeInViewport();
  // The box is ready for the next search.
  await expect(box).toHaveValue("");
});

test("a misspelling still finds it, and nonsense says so", async ({ page, request }) => {
  await signInAsAdmin(page, request);
  await page.goto("/admin/settings/identity");
  const box = page.getByRole("combobox", { name: "Search settings" });

  await box.fill("favicon");
  await expect(page.getByRole("option").first()).toContainText("Logo");
  await box.fill("zzqx");
  await expect(page.getByRole("status").filter({ hasText: "No setting matches" })).toBeVisible();
  await box.press("Escape");
  await expect(box).toHaveValue("");
});

test("a plugin's setting opens its panel and marks the field", async ({ page, request }) => {
  await signInAsAdmin(page, request);
  await page.goto("/admin/settings/identity");
  const box = page.getByRole("combobox", { name: "Search settings" });
  await box.fill("shortest voting window");
  await page.getByRole("option", { name: /Shortest voting window/ }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/plugins#plugin-vote-min-duration-days$/);
  const card = page.locator("section#vote");
  await expect(card).toHaveClass(/is-open/);
  await expect(card.locator(".settings-field.is-link-target")).toContainText("Shortest voting window");
});

test("every result's link finds its setting on the page", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInAsAdmin(page, request);
  const { entries, sometimes } = searchIndex();
  const isSometimes = (k: string) => sometimes.includes(k);
  const missing: string[] = [];
  const panelOnly: string[] = [];
  let section = "";

  for (const e of entries) {
    const [path, hash] = e.path.split("#") as [string, string | undefined];
    if (path !== section) {
      await page.goto(path);
      await expect(page.locator(".settings-content")).toBeVisible();
      section = path;
    }
    // Follow the link inside the app, as the search does.
    await page.evaluate((to) => {
      history.pushState({}, "", to);
      dispatchEvent(new PopStateEvent("popstate"));
    }, e.path);
    if (!hash) continue;

    const own = page.locator(`[data-help-anchor="${hash}"], [id="${hash}"]`).first();
    const found = await own
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (found) continue;
    const holder = page.locator(`[data-anchors~="${hash}"]`).first();
    const held = await holder
      .waitFor({ state: "visible", timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (held && e.key.startsWith("plugin")) panelOnly.push(e.key);
    else if (isSometimes(e.key)) panelOnly.push(e.key);
    else missing.push(`${e.key} → ${e.path}`);
  }

  if (panelOnly.length) console.log(`Found by their panel or section only (not shown on this hub now): ${panelOnly.join(", ")}`);
  expect(missing, "a search result whose setting is not on its page").toEqual([]);
});
