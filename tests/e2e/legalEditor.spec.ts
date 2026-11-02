/**
 * Legal templates as a normal form (pilot readiness 2, item 11), in Chromium and
 * WebKit: contentEditable and the browser's editing commands are what differ
 * between them. An admin of a new hub reads a preview with their own values,
 * opens the structured editor, sees no braces, changes words with the toolbar,
 * sees them in the preview, saves, and restores the shared default.
 */

import { test, expect } from "@playwright/test";
import { CURRENT_LEGAL_VERSION } from "../../ui/src/config/legal.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const created: string[] = [];

async function newHub(browserName: string) {
  const slug = `edit-${browserName.slice(0, 2)}${created.length}-${run}`;
  const admin = `${slug}@example.test`;
  const cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug,
      name: "Editor Test Hub",
      hostname: `${slug}.localhost`,
      admin_email: admin,
      hub_kind: "place",
      jurisdiction_type: "county",
      jurisdiction_name: "Jefferson County, Colorado",
      jurisdiction_ocd_id: "ocd-division/country:us/state:co/county:jefferson",
      ownership: { "legal.contact_email": `contact-${slug}@example.test` },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  const token = await mintSession(slug, admin);
  await localRest(`users?hub_id=eq.${slug}&email=eq.${encodeURIComponent(admin)}`, {
    method: "PATCH",
    body: JSON.stringify({ tos_version_accepted: CURRENT_LEGAL_VERSION }),
  });
  return { slug, token, base: `${UI.protocol}//${slug}.localhost${UI.port ? `:${UI.port}` : ""}` };
}

test.afterAll(async () => {
  const cookie = await mintConsoleSession();
  for (const id of created) {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: code } });
  }
});

test("an admin edits the Terms without seeing a brace, and the preview follows", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const { slug, token, base } = await newHub(browserName);
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);

  await page.goto(`${base}/admin/settings/legal`);
  const terms = page.getByRole("group", { name: "Terms of Service" });

  // The preview first: the hub's own values, its own state's law, no braces, no editor.
  const preview = terms.getByLabel("Preview of Terms of Service");
  await expect(preview).toContainText("Jefferson County");
  await expect(preview).toContainText("governed by the laws of Colorado");
  await expect(preview).toContainText("operated by its administrators");
  await expect(preview).not.toContainText("{");
  await expect(terms.getByRole("textbox")).toHaveCount(0);
  await expect(terms).toContainText("Using the shared default");

  // The form: a field per section, labelled, with chips; nothing in braces, no HTML.
  if (process.env.CIVIC_E2E_SHOT) await page.screenshot({ path: `${process.env.CIVIC_E2E_SHOT}-preview-${browserName}.png` });
  await terms.getByRole("button", { name: "Edit the wording" }).click();
  const fields = terms.getByRole("textbox");
  expect(await fields.count()).toBeGreaterThan(5);
  for (const text of await fields.allInnerTexts()) {
    expect(text).not.toMatch(/\{|\}|<[a-z]/);
  }
  await expect(terms.locator(".doc-field-box .doc-chip").first()).toHaveAttribute("contenteditable", "false");
  // Another kind's wording isn't here.
  await expect(terms).not.toContainText("One person, one voice");

  // Change one field, with Bold and a chip, and read it in the preview.
  const contact = terms.getByRole("textbox", { name: "Contact" });
  await expect(contact.locator(".doc-chip", { hasText: "contact email" })).toHaveCount(1);
  await contact.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Write to our volunteers at ");
  await terms.getByRole("toolbar", { name: "Format Contact" }).getByRole("button", { name: "contact email" }).click();
  await page.keyboard.type("or just ");
  await terms.getByRole("toolbar", { name: "Format Contact" }).getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("call us");
  await contact.scrollIntoViewIfNeeded();
  if (process.env.CIVIC_E2E_SHOT) await page.screenshot({ path: `${process.env.CIVIC_E2E_SHOT}-editor-${browserName}.png` });
  await terms.getByRole("button", { name: "Back to the preview" }).click();
  await expect(preview).toContainText("Write to our volunteers at contact-");
  await expect(preview.locator("strong", { hasText: "call us" })).toBeVisible();
  await expect(terms).toContainText("This hub's own version");
  // A section nobody touched still reads as before.
  await expect(preview).toContainText("governed by the laws of Colorado");

  // Save: the words are on the public page, and what's stored keeps the placeholder.
  const bar = page.getByRole("group", { name: "Save this section" });
  await bar.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bar.getByText("Saved.")).toBeVisible();
  const stored = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.legal.terms&select=value`)) as Array<{ value: string }>;
  expect(stored[0]!.value).toContain("Write to our volunteers at {CONTACT_EMAIL}");
  expect(stored[0]!.value).toContain("{{#place}}");
  await page.goto(`${base}/terms`);
  await expect(page.locator(".legal-prose")).toContainText("Write to our volunteers at contact-");

  // Back in the form, the saved words open; Restore goes back to the shared text.
  await page.goto(`${base}/admin/settings/legal`);
  await terms.getByRole("button", { name: "Edit the wording" }).click();
  await expect(terms.getByRole("textbox", { name: "Contact" })).toContainText("our volunteers");
  await terms.getByRole("button", { name: "Restore default" }).click();
  await expect(terms.getByRole("textbox", { name: "Contact" })).not.toContainText("our volunteers");
  await expect(terms).toContainText("Using the shared default");
  await bar.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bar.getByText("Saved.")).toBeVisible();
  // Stored as nothing, so it stays in step with the shared text.
  const after = (await localRest(`hub_settings?hub_id=eq.${slug}&key=eq.legal.terms&select=value`)) as Array<{ value: string }>;
  expect(after[0]?.value ?? "").toBe("");
});

test("pasting brings the words only", async ({ page, browserName }) => {
  const { token, base } = await newHub(browserName);
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
  await page.goto(`${base}/admin/settings/legal`);
  const who = page.getByRole("group", { name: '"Who runs this site"' });
  await expect(who.getByLabel(/^Preview of/)).toContainText("operated by its administrators");
  await who.getByRole("button", { name: "Edit the wording" }).click();
  // A short fragment splits by paragraph, with the two labels Adam named.
  await expect(who.getByRole("textbox", { name: "The opening paragraph" })).toBeVisible();
  const line = who.getByRole("textbox", { name: "The contact line" });
  await line.click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", '<img src=x onerror="window.pasted=1"><b>rich</b>');
    data.setData("text/plain", "plain words");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(line).toContainText("plain words");
  await expect(line.locator("img, b")).toHaveCount(0);
});
