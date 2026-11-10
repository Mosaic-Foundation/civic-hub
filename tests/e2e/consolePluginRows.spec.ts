/**
 * The console's Plugins section, one row per plugin (console slice,
 * 2026-11-09): Events with three versions, the one this deployment runs, an
 * older one withdrawn and a newer one waiting. The row marks the running
 * version, offers Approve on the waiting one only, and its Version dropdown
 * lists all three, newest first, each with its own record. At desktop and
 * phone width.
 *
 * The two extra versions are rows this spec writes into the local catalog,
 * at versions of its own, and withdraws after (catalog rows are never
 * deleted; hashes no deployment loads, so nothing mounts them). Needs the
 * console's env on the API, as e2e.yml runs it.
 */

import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { mintConsoleSession } from "../fixtures/consoleCall.js";

const UI = new URL(process.env.CIVIC_E2E_UI_ORIGIN?.trim() || "http://localhost:5173");
const CONSOLE_UI = `${UI.protocol}//console.localhost${UI.port ? `:${UI.port}` : ""}/console.html`;
const EVENTS = "@civic-social/plugin-events";

interface Row {
  id: string;
  version: string;
  status: string;
  display_name: string;
  plugin: string;
  process_type: string;
  capabilities: unknown;
  conformance: unknown;
}

let made: string[] = [];
let runningVersion = "";
const n = Math.floor(Math.random() * 1e6);
const OLD = `0.0.${n}`;
// Newer than any an earlier run left (withdrawn) in a reused local catalog.
const NEW = `99.${Date.now()}.0`;

test.beforeAll(async () => {
  const deployed = (await localRest(
    `plugin_catalog?select=id,version,status,display_name,plugin,process_type,capabilities,conformance&package=eq.${encodeURIComponent(EVENTS)}&status=eq.approved&order=created_at.desc&limit=1`,
  )) as Row[];
  const base = deployed[0];
  expect(base, "the local catalog approves an Events version").toBeTruthy();
  runningVersion = base!.version;
  const extra = (version: string, status: "pending" | "withdrawn") => ({
    package: EVENTS,
    version,
    hash: `sha256:${randomBytes(32).toString("hex")}`,
    display_name: base!.display_name,
    plugin: base!.plugin,
    process_type: base!.process_type,
    capabilities: base!.capabilities,
    conformance: base!.conformance,
    status,
    auto_install: false,
    approved_by: status === "withdrawn" ? "operator@example.test" : null,
    approved_at: status === "withdrawn" ? "2026-10-01T12:00:00Z" : null,
    withdrawn_at: status === "withdrawn" ? "2026-10-02T12:00:00Z" : null,
  });
  const rows = (await localRest("plugin_catalog?select=id", {
    method: "POST",
    body: JSON.stringify([extra(OLD, "withdrawn"), extra(NEW, "pending")]),
  })) as Array<{ id: string }>;
  made = rows.map((r) => r.id);
  expect(made).toHaveLength(2);
});

test.afterAll(async () => {
  if (made.length) {
    await localRest(`plugin_catalog?id=in.(${made.join(",")})&status=eq.pending`, {
      method: "PATCH",
      body: JSON.stringify({ status: "withdrawn", approved_by: "operator@example.test", approved_at: new Date().toISOString(), withdrawn_at: new Date().toISOString() }),
    });
  }
});

for (const vp of [
  { label: "desktop", width: 1280, height: 900 },
  { label: "phone", width: 390, height: 844 },
]) {
  test(`one row per plugin at ${vp.label} width: running marked, Approve on the newest waiting, every version in the dropdown`, async ({ page, context }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const cookie = await mintConsoleSession();
    const [name, value] = cookie.split("=");
    await context.addCookies([{ name: name!, value: decodeURIComponent(value!), domain: "console.localhost", path: "/" }]);
    await page.goto(`${CONSOLE_UI}#/plugins`);

    const row = page.getByTestId(`catalog-${EVENTS}`);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("catalog-running")).toHaveText(`Running ${runningVersion}`);

    // Approve once, on the waiting version, in the row itself.
    await expect(row.getByText(`Version ${NEW} is waiting for approval`)).toBeVisible();
    await expect(row.getByRole("button", { name: `Approve ${NEW}`, exact: true })).toHaveCount(1);
    await expect(row.getByRole("button", { name: /^Approve \d/ })).toHaveCount(1);

    // The dropdown: newest first (the waiting one first; the running and the
    // withdrawn one among the rest), the running one chosen.
    const versions = row.getByLabel("Version");
    const running = new RegExp(`^${runningVersion.replace(/\./g, "\\.")} \\(running`);
    const options = await versions.locator("option").allInnerTexts();
    expect(options[0]).toBe(`${NEW} (waiting for approval)`);
    expect(options).toContain(`${OLD} (withdrawn)`);
    expect(options.filter((o) => running.test(o))).toHaveLength(1);
    await expect(versions.locator("option:checked")).toHaveText(running);
    const record = row.getByTestId("catalog-record");
    await expect(record.getByTestId("catalog-version-status")).toHaveText("Approved");
    await expect(record.getByRole("button", { name: "Withdraw", exact: true })).toBeVisible();

    // The withdrawn one keeps its record: who approved it, and its withdrawal.
    await versions.selectOption({ label: `${OLD} (withdrawn)` });
    await expect(record.getByTestId("catalog-version-status")).toHaveText("Withdrawn");
    await expect(record).toContainText("Approved by operator@example.test");
    await expect(record).toContainText("Withdrawn on");

    // The waiting one, and the withdrawn one, can be approved from their record.
    await expect(record.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    await versions.selectOption({ label: `${NEW} (waiting for approval)` });
    await expect(record.getByTestId("catalog-version-status")).toHaveText("Waiting for approval");
    await expect(record.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

    // Nothing runs wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
