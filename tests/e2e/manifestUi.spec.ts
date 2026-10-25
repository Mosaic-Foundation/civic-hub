/**
 * Architecture 2 (ADR-009): the UI is built from each type's manifest and UI
 * module (ui/src/processes/), and the hub looks and behaves as before. Walks
 * the home page, every section page, a detail page of every type, the Plugins
 * settings page and the link picker, on the hub `localhost` resolves to
 * (Athens with CI's env), and checks what each should show.
 *
 * Also the one deliberate change: /process/:id for a type with a page of its
 * own goes to that page (it rendered the vote page before).
 */

import { test, expect } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { adminEmailFor, hubId, liveProposal, run, session, visitAs } from "./actors";
import { E2E_API_BASE as API } from "./hubApi";

interface ProcessType {
  type: string;
  plugin: string;
  label: string;
  section?: { id: string; label: string; path: string };
}

test.describe("every type's pages, from the manifests", () => {
  test("the home page and every section page answer with their heading and no error", async ({ page, request }) => {
    const config = await (await request.get(`${API}/hub-config`)).json();
    const types = config.process_types as ProcessType[];
    const sections = types.filter((t) => t.section && config.settings[`plugin.${t.plugin}.enabled`] !== "false");
    expect(sections.length).toBeGreaterThanOrEqual(4);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("seen_intro_popup", "true");
      localStorage.setItem("welcome-banner-dismissed-v2", "true");
      sessionStorage.setItem("civic_preview", "1");
    });

    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    for (const t of sections) {
      await page.goto(t.section!.path);
      await expect(page.getByRole("heading", { name: t.section!.label, exact: false }).first(), t.section!.path).toBeVisible();
      await expect(page.getByText("Page not found")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test("a detail page of every type opens at its own path", async ({ page, request }) => {
    const hub = await hubId(request);
    const config = await (await request.get(`${API}/hub-config`)).json();
    const types = (config.process_types as ProcessType[]).filter((t) => config.settings[`plugin.${t.plugin}.enabled`] !== "false");
    const admin = await session(hub, adminEmailFor(hub));
    await visitAs(page, admin.token);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const opened: string[] = [];
    for (const t of types) {
      // A record the page shows: live, and published where an admin publishes it.
      const rows = (await localRest(
        `processes?select=id,state&hub_id=eq.${hub}&type=eq.${t.type}&status=not.in.(pending_review,archived,draft)&order=created_at.desc&limit=20`,
      )) as Array<{ id: string; state: Record<string, unknown> | null }>;
      const row = rows.find((r) => {
        const s = r.state ?? {};
        return s.publication_status === undefined && s.approval_status === undefined
          ? true
          : s.publication_status === "published" || s.approval_status === "published";
      });
      if (!row) continue;
      const res = await request.get(`${API}/process/${row.id}`, { headers: { Accept: "application/ld+json" } });
      expect(res.status(), `${t.type} descriptor`).toBe(200);
      const view = (await res.json()).endpoints.view as string;
      const path = new URL(view).pathname;
      await page.goto(path);
      await expect(page.getByText("Page not found")).toHaveCount(0);
      await expect(page.getByText("Not found.", { exact: true })).toHaveCount(0);
      await expect(page.locator("main h1, main h2").first(), `${t.type} at ${path}`).toBeVisible();
      opened.push(t.type);
    }
    // Every type with a live, published record opened; a fresh seed has at
    // least these (hub-made types appear once a brief or summary is published).
    for (const t of ["civic.vote", "civic.proposal", "civic.project"]) expect(opened, `opened: ${opened.join(", ")}`).toContain(t);
    expect(errors).toEqual([]);
  });

  test("/process/:id for a type with its own page goes to that page", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    const creator = await session(hub, `manifest-ui-${run}@example.test`);
    const id = await liveProposal(request, creator.token, admin.token, `Manifest UI proposal ${run}`);
    await visitAs(page, admin.token);
    await page.goto(`/process/${id}`);
    await expect(page).toHaveURL(new RegExp(`/proposal/${id}$`));
    await expect(page.getByRole("heading", { name: `Manifest UI proposal ${run}` })).toBeVisible();
  });
});

test.describe("the Plugins page and the link picker", () => {
  test("the Plugins page lists every plugin by name, in the section's order", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    await visitAs(page, admin.token);
    await page.goto("/admin/settings/plugins");
    const names = [
      "Votes",
      "Proposals",
      "Projects",
      "Conversations",
      "Word clouds",
      "Briefs",
      "Announcements",
      "Meeting summaries",
      "News sync",
      "Writing assistant",
      "Search",
      "Feedback",
    ];
    for (const name of names) {
      await expect(page.getByText(name, { exact: true }).first(), name).toBeVisible();
    }
    // The vote plugin's own panel (its UI module's), under Votes once opened.
    await page.getByRole("region", { name: "Votes" }).locator(".plugin-card-head").click();
    await expect(page.getByText("Shortest voting window")).toBeVisible();
  });

  test("the link picker searches processes and names their types", async ({ page, request }) => {
    const hub = await hubId(request);
    const admin = await session(hub, adminEmailFor(hub));
    const creator = await session(hub, `manifest-link-${run}@example.test`);
    const id = await liveProposal(request, creator.token, admin.token, `Manifest link source ${run}`);
    // Something of its own to find: the fixture set's hub has no other processes to link to.
    await liveProposal(request, creator.token, admin.token, `Manifest link target ${run}`);
    await visitAs(page, admin.token);
    await page.goto(`/proposal/${id}`);
    await page.getByRole("button", { name: "+ Add a related process" }).click();
    const search = page.getByPlaceholder("Search votes, proposals, projects, conversations…");
    await expect(search).toBeVisible();
    await search.fill(`Manifest link target ${run}`);
    const results = page.locator(".link-picker__result-meta");
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    const labels = await results.allTextContents();
    const known = ["Vote", "Vote results", "Brief", "Proposal", "Project", "Conversation", "Word cloud", "Announcement", "Meeting summary"];
    for (const l of labels) expect(known, l).toContain(l.trim());
  });
});
