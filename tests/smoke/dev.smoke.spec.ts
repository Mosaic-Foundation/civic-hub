/**
 * The dev smoke suite (release tooling slice, 2026-10-13): what Adam checked
 * by hand after each dev deploy (Submit-And-Save session report, "Dev
 * checklist for you"), run against the LIVE dev deployment by
 * .github/workflows/smoke.yml once Vercel reports the deploy.
 *
 * It runs on the dedicated smoke hub (beta, so submissions wait for an
 * admin) and nowhere else: tests/smoke/devStack.ts refuses any other hub, and
 * any database but dev's. The Code of Conduct check here is the REAL one
 * (Vercel refuses CIVIC_COC_FAKE), so the flagged text below is an
 * unmistakable personal attack on a made-up neighbour, and a clean text is
 * plainly clean.
 *
 * One serial group, so the items one step makes are what the next acts on,
 * and afterAll can put away everything the run made:
 *   - pending reviews are declined, the approved vote is archived;
 *   - the run's residents delete their accounts (their drafts and sessions go
 *     with them), and the admin's minted sessions are ended.
 * Events and review turns are append-only by design, so their history stays
 * on the smoke hub; that is why it is its own hub.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  adminEmail,
  apiBase,
  assertSmokeHub,
  baseUrl,
  devRest,
  endMintedSessions,
  mintSession,
  missingSmokeEnv,
  plantSample,
  plantSignInLink,
  removeSample,
} from "./devStack";

const run = Date.now().toString(36);
const CLEAN = "A routine check after a deploy: should the benches by the library stay where they are?";
// The marker at the end is what the local stack's fake check flags (a run
// proving the suite before CI); the real check on dev flags the words.
const FLAGGED =
  "Bob Testerman on Maple Lane is a lying thief and a disgusting idiot. Everyone should go to his house and make him regret living here. [coc-flag]";

test.describe.configure({ mode: "serial" });

const missing = missingSmokeEnv();
test.skip(missing.length > 0, `Smoke suite skipped: set ${missing.join(", ")} (see tests/smoke/devStack.ts).`);

let admin = "";
let resident = "";
const residents: string[] = [];
const pendingReviews = new Set<string>();
const liveProcesses: string[] = [];
const plantedSamples: string[] = [];
let cleanReview = { id: "", title: "" };
let flaggedReview = { id: "", title: "" };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A page of its own (each step acts as one person), at the smoke hub. */
async function open(browser: Browser, opts: { viewport?: { width: number; height: number } } = {}): Promise<Page> {
  return browser.newPage({ baseURL: baseUrl(), ...opts });
}

async function visitAs(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
    localStorage.setItem("civic_auth_token", t);
  }, token);
}

async function newResident(n: string): Promise<string> {
  const { token } = await mintSession(`smoke-${run}-${n}@example.test`);
  residents.push(token);
  return token;
}

/**
 * Write a vote and press Submit, then the preview's Submit. Resolves to the
 * submit response. With `options`, an approval vote with those options and
 * one more "+ Add option" left empty, which must not block Submit.
 */
async function writeVoteAndSubmit(page: Page, title: string, description: string, options?: string[]) {
  await page.goto("/votes/new");
  if (options) await page.getByRole("button", { name: "Approval (pick from options)" }).click();
  await page.locator("#draft-title").fill(title);
  await page.locator("#draft-description").fill(description);
  if (options) {
    for (const [i, o] of options.entries()) await page.getByRole("textbox", { name: `Option ${i + 1}` }).fill(o);
    await page.getByRole("button", { name: "+ Add option" }).click();
    await expect(page.getByRole("textbox", { name: `Option ${options.length + 1}` })).toHaveValue("");
    await page.getByRole("textbox", { name: `Option ${options.length + 1}` }).blur();
    await expect(page.getByRole("button", { name: "Submit vote" }).last()).toBeEnabled();
  }
  await page.getByRole("button", { name: "Submit vote" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Submit your vote" })).toBeVisible();
  const answered = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()), { timeout: 45_000 });
  await dialog.getByRole("button", { name: /^Submit/ }).click();
  return answered;
}

async function reviewCard(page: Page, title: string) {
  await page.goto("/admin/reviews");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  return page.locator(".process-card").filter({ hasText: title });
}

test.beforeAll(async () => {
  await assertSmokeHub();
  admin = (await mintSession(adminEmail())).token;
  resident = await newResident("r");
});

test.afterAll(async ({ playwright }) => {
  if (!admin) return;
  const request = await playwright.request.newContext();
  const errors: string[] = [];
  for (const id of pendingReviews) {
    const r = await request.post(`${apiBase()}/admin/reviews/${id}/decline`, {
      headers: auth(admin),
      data: { reason: "Smoke test cleanup." },
    });
    if (!r.ok()) errors.push(`decline ${id}: ${r.status()}`);
  }
  for (const id of liveProcesses) {
    // Archived, not closed: an approved resident vote may still be gathering
    // support (proposed), which has nothing to close. Archiving works in any state.
    const r = await request.post(`${apiBase()}/admin/processes/${id}/archive`, {
      headers: auth(admin),
      data: { reason: "Smoke test cleanup." },
    });
    if (!r.ok()) errors.push(`archive ${id}: ${r.status()}`);
  }
  for (const id of plantedSamples) await removeSample(id);
  for (const token of residents) {
    const r = await request.delete(`${apiBase()}/auth/me`, { headers: auth(token) });
    if (!r.ok()) errors.push(`delete account: ${r.status()}`);
  }
  await request.dispose();
  await endMintedSessions();
  if (errors.length) throw new Error(`smoke cleanup left things behind: ${errors.join("; ")}`);
});

test("health is ok with no schema gaps, and an unknown API route answers JSON 404", async ({ request }) => {
  const health = await request.get(`${apiBase()}/health`);
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body.status).toBe("ok");
  expect(body.schema.gaps).toEqual([]);
  const expected = process.env.CIVIC_SMOKE_EXPECT_COMMIT?.trim();
  if (expected) expect(body.commit).toBe(expected);

  const missingRoute = await request.post(`${apiBase()}/smoke-check-no-such-route`);
  expect(missingRoute.status()).toBe(404);
  expect(missingRoute.headers()["content-type"]).toContain("application/json");
  expect((await missingRoute.json()).code).toBe("not_found");
});

test("a resident and an admin are signed in", async ({ browser }) => {
  const r = await open(browser);
  await visitAs(r, resident);
  await r.goto("/");
  await expect(r.getByRole("button", { name: "Account menu" })).toBeVisible();
  await r.close();

  const a = await open(browser);
  await visitAs(a, admin);
  await a.goto("/admin/reviews");
  await expect(a.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await a.close();
});

test("a new resident signs in with the email's link at phone width, and joins beside the terms notice", async ({ browser }) => {
  // The link path, not a minted session (sign-in slice, 2026-10-14).
  const email = `smoke-${run}-link@example.test`;
  const token = await plantSignInLink(email);
  const page = await open(browser, { viewport: { width: 375, height: 812 } });
  await page.addInitScript(() => {
    localStorage.setItem("seen_intro_popup", "true");
    localStorage.setItem("welcome-banner-dismissed-v2", "true");
    sessionStorage.setItem("civic_preview", "1");
  });
  await page.goto(`/sign-in#t=${token}`);
  await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  // The join step: the policies are one line beside Join, not a checkbox.
  const join = page.getByRole("button", { name: "Join", exact: true });
  await expect(join).toBeVisible();
  const notice = page.locator(".auth-terms-notice");
  await expect(notice).toHaveText("By joining you agree to the Code of Conduct, Privacy Notice and Terms.");
  await expect(notice.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacy");
  await page.getByPlaceholder("Jane Doe").fill("Smoke Link");
  const residency = page.locator(".auth-legal-checkbox input[type=checkbox]");
  if (await residency.count()) await residency.check();
  await join.click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  const session = await page.evaluate(() => localStorage.getItem("civic_auth_token"));
  expect(session).toBeTruthy();
  residents.push(session!); // its account is deleted in afterAll
  await page.close();
});

test("a clean vote on a beta hub waits in the admins' queue; an empty extra option doesn't block Submit", async ({ browser }) => {
  const page = await open(browser);
  await visitAs(page, resident);
  const title = `Smoke vote ${run}`;
  const res = await writeVoteAndSubmit(page, title, CLEAN, ["Keep them by the library", "Move them to the park"]);
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.auto_approved).toBe(false);
  cleanReview = { id: body.review_id, title };
  pendingReviews.add(body.review_id);
  await expect(page).toHaveURL(new RegExp(`/my-submissions/${body.review_id}`));
  await page.close();

  const a = await open(browser);
  await visitAs(a, admin);
  await expect(await reviewCard(a, title)).toBeVisible();
  await a.close();
});

test("a flagged draft is refused and kept; 'Tell the admins' reaches the queue marked flagged", async ({ browser }) => {
  const page = await open(browser);
  await visitAs(page, resident);
  const title = `Smoke flagged ${run}`;
  const res = await writeVoteAndSubmit(page, title, FLAGGED);
  expect(res.status(), await res.text()).toBe(400);
  expect((await res.json()).code).toBe("code_of_conduct_flagged");

  // Nothing submitted: still on the form, the text as typed, what to fix shown.
  await expect(page).toHaveURL(/\/votes\/new/);
  await expect(page.locator("#draft-title")).toHaveValue(title);
  await expect(page.getByRole("region", { name: "Change this before submitting" })).toBeVisible();

  await page.getByRole("button", { name: "Tell the admins" }).click();
  const dialog = page.getByRole("dialog", { name: "Tell the admins" });
  await dialog.getByLabel(/A note for the admins/).fill("Smoke test: please look at this one.");
  const sent = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()), { timeout: 45_000 });
  await dialog.getByRole("button", { name: "Send to the admins" }).click();
  const body = await (await sent).json();
  expect(body).toMatchObject({ flagged: true, auto_approved: false });
  flaggedReview = { id: body.review_id, title };
  pendingReviews.add(body.review_id);
  await expect(page.getByText(/Sent to the admins, with what the Code of Conduct check flagged/)).toBeVisible();
  await page.close();

  const a = await open(browser);
  await visitAs(a, admin);
  await expect((await reviewCard(a, title)).getByText("Flagged by the check")).toBeVisible();
  await a.close();
});

test("approve and decline each land on the list with a confirmation", async ({ browser }) => {
  test.skip(!cleanReview.id || !flaggedReview.id, "needs the two submissions above");
  const page = await open(browser);
  await visitAs(page, admin);

  await page.goto(`/admin/reviews/${cleanReview.id}`);
  await page.getByRole("button", { name: "Approve & post" }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole("status").filter({ hasText: `Approved: “${cleanReview.title}”` })).toBeVisible();
  pendingReviews.delete(cleanReview.id);
  const [approved] = (await devRest(`process_reviews?select=process_id&id=eq.${cleanReview.id}`)) as Array<{ process_id: string | null }>;
  if (approved?.process_id) liveProcesses.push(approved.process_id);

  await page.goto(`/admin/reviews/${flaggedReview.id}`);
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByPlaceholder("Reason for declining").fill("Smoke test: declined on purpose.");
  await page.getByRole("button", { name: /Decline/ }).last().click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole("status").filter({ hasText: `Declined: “${flaggedReview.title}”.` })).toBeVisible();
  pendingReviews.delete(flaggedReview.id);
  await page.close();
});

test("admin settings: an unsaved change keeps Save in view, and leaving asks first", async ({ browser }) => {
  const page = await open(browser);
  await visitAs(page, admin);
  await page.goto("/admin/settings/copy");
  const bar = page.getByRole("group", { name: "Save this section" });
  const save = bar.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();

  const field = page.locator(".settings-form textarea").first();
  await field.fill(`${await field.inputValue()} (smoke)`);
  await expect(bar.getByText("You have unsaved changes.")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(save).toBeInViewport();

  let asked = "";
  page.once("dialog", async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page.getByRole("link", { name: "Feed", exact: true }).first().click();
  expect(asked).toMatch(/unsaved changes/);
  await expect(page).toHaveURL(/\/admin\/settings\/copy/);

  // Discard: nothing is saved, the hub's copy is as it was.
  await bar.getByRole("button", { name: "Discard changes" }).click();
  await expect(save).toBeDisabled();
  await page.close();
});

test("a drafting form at phone width: the slim header, and the bar steps aside on focus", async ({ browser }) => {
  const page = await open(browser, { viewport: { width: 375, height: 812 } });
  await visitAs(page, resident);
  await page.goto("/votes/new");
  await expect(page.getByRole("heading", { level: 1, name: "New vote" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Back to / })).toBeVisible();
  await expect(page.locator(".civic-nav")).toBeHidden();

  const submit = page.getByRole("button", { name: "Submit vote" }).last();
  await expect(submit).toBeInViewport();
  // Focus only: typing would save a draft, and this check needs none.
  await page.locator("#draft-title").focus();
  await expect(submit).toBeHidden();
  await page.locator("#draft-title").blur();
  await expect(submit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

test("Edit & resubmit after an admin requests changes: the same item, back in the queue", async ({ browser, request }) => {
  const page = await open(browser);
  const token = await newResident("e");
  await visitAs(page, token);
  const title = `Smoke resubmit ${run}`;
  const res = await writeVoteAndSubmit(page, title, CLEAN);
  expect(res.status(), await res.text()).toBe(201);
  const reviewId = (await res.json()).review_id as string;
  pendingReviews.add(reviewId);
  await expect(page).toHaveURL(new RegExp(`/my-submissions/${reviewId}`));

  const asked = await request.post(`${apiBase()}/admin/reviews/${reviewId}/request-changes`, {
    headers: auth(admin),
    data: { note: "Smoke test: please say who will look after them." },
  });
  expect(asked.status()).toBe(200);

  // As Adam did: stay on the tab and reload.
  await page.reload();
  await expect(page.getByText("Changes requested").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit & resubmit" }).click();
  await expect(page).toHaveURL(new RegExp(`review=${reviewId}`));
  await expect(page.locator("#draft-title")).toHaveValue(title);
  await page.locator("#draft-description").fill(`${CLEAN} The library's volunteers look after them.`);
  await page.getByRole("button", { name: "Submit vote" }).click();
  const resubmitted = page.waitForResponse((r) => /\/drafts\/[^/]+\/submit$/.test(r.url()), { timeout: 45_000 });
  await page.getByRole("dialog").getByRole("button", { name: /^Submit/ }).click();
  const body = await (await resubmitted).json();
  expect(body.review_id).toBe(reviewId);
  await expect(page).toHaveURL(new RegExp(`/my-submissions/${reviewId}`));
  await page.close();
});

test("voting on a phone: the page holds still, the share banner goes by itself, the receipt is one compact box", async ({ browser, request }) => {
  // An open vote an admin made: residents' votes on the smoke hub may need
  // endorsements first. Archived by afterAll.
  const made = await request.post(`${apiBase()}/process`, {
    headers: auth(admin),
    data: {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Smoke ballot ${run}`,
      description: "A vote the smoke suite casts a ballot on.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  const voteId = (await made.json()).id as string;
  liveProcesses.push(voteId);
  const opened = await request.post(`${apiBase()}/process/${voteId}/action`, {
    headers: auth(admin),
    data: { type: "process.activate", payload: {} },
  });
  expect(opened.ok(), await opened.text()).toBeTruthy();

  const page = await open(browser, { viewport: { width: 375, height: 640 } });
  await visitAs(page, await newResident("v"));
  await page.goto(`/process/${voteId}`);
  const no = page.getByRole("button", { name: "No", exact: true });
  await no.evaluate((b) => b.scrollIntoView({ block: "start" }));
  const ballot = page.locator(".vote-buttons");
  const before = (await ballot.boundingBox())!.y;
  await no.click();

  // Where the voter was: the ballot hasn't moved; the banner shows and goes.
  await expect(page.locator(".vote-receipt-box")).toBeVisible();
  expect(Math.abs((await ballot.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
  const nudge = page.locator(".share-banner, .share-callout");
  await expect(nudge).toContainText("share this");
  await expect(nudge).toHaveCount(0, { timeout: 8_000 });
  expect(Math.abs((await ballot.boundingBox())!.y - before)).toBeLessThanOrEqual(2);

  // The receipt: the download button with the code beside it, Check it below.
  const box = page.locator(".vote-receipt-box");
  const button = (await box.getByRole("button", { name: /Download\s+receipt \(PDF\)/ }).boundingBox())!;
  const code = (await box.locator(".vote-receipt-id code").boundingBox())!;
  const check = (await box.getByRole("link", { name: "Check it" }).boundingBox())!;
  expect(code.x).toBeGreaterThanOrEqual(button.x + button.width);
  expect(code.y).toBeLessThan(button.y + button.height);
  expect(check.y).toBeGreaterThanOrEqual(Math.max(button.y + button.height, code.y + code.height) - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

// --- Admin menu slice (2026-10-13) ------------------------------------------

test("the Admin menu opens at phone width with its counts; the review icon says the same", async ({ browser, request }) => {
  const counts = await (await request.get(`${apiBase()}/admin/queue-counts`, { headers: auth(admin) })).json();
  const reviews = counts.reviews + counts.briefs + counts.meeting_summaries;
  const page = await open(browser, { viewport: { width: 375, height: 812 } });
  await visitAs(page, admin);
  await page.goto("/");
  await expect(page.getByTestId("admin-review-icon")).toHaveAttribute(
    "aria-label",
    reviews > 0 ? `Reviews: ${reviews} new` : "Reviews: nothing new",
  );
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Admin" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    reviews > 0 ? `Reviews${reviews}` : "Reviews",
    "Moderation",
    "Settings",
    "Plugins",
  ]);
  await menu.getByRole("menuitem", { name: "Plugins" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/plugins$/);
  await page.close();
});

test("a \"?\" beside a setting opens its note, with a link to the docs", async ({ browser }) => {
  const page = await open(browser, { viewport: { width: 375, height: 812 } });
  await visitAs(page, admin);
  await page.goto("/admin/settings/identity");
  await page.getByRole("button", { name: "About Hub name" }).click();
  const note = page.getByRole("note");
  await expect(note).toBeVisible();
  await expect(note.getByRole("link", { name: "More in the docs" })).toHaveAttribute(
    "href",
    /^https:\/\/docs\.civic\.social\/reference\/settings\/identity#identity-name$/,
  );
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  await page.close();
});

test("an admin deletes one sample from Settings, and Next: set up your hub follows the last", async ({ browser }) => {
  const title = `Smoke sample ${run}`;
  plantedSamples.push(await plantSample(title));
  const page = await open(browser, { viewport: { width: 375, height: 812 } });
  await visitAs(page, admin);
  await page.goto("/admin/settings/sample");
  await page.getByRole("button", { name: `Delete sample: ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this sample?" });
  await dialog.getByRole("button", { name: "Delete sample" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Deleted “${title}”.` })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Next: set up your hub" })).toBeVisible();
  await page.close();
});
