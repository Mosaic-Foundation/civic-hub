/**
 * The feed reads the hub's public stream (frontend pass, 2026-10-24).
 *
 * The "All" view of a hub with no sample content reads GET /events and asks
 * GET /api/feed/meta for what the stream does not carry
 * (ui/src/services/wireFeed.ts). This proves it shows what /api/feed showed:
 * for a signed-out reader, a member and an admin, the same cards in the same
 * order, each with the same link, pill, title, author name, summary,
 * engagement line and time. A name the stream shows a signed-out reader where
 * /api/feed did not is a failure (ADR-010: the views redact by type).
 *
 * Floyd, not Athens: Athens is a demo hub, whose visitors' items are sample
 * content, never on the stream, so its feed keeps /api/feed.
 * `sessionStorage.civic_feed_source = "internal"` is the /api/feed half.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { localRest } from "../fixtures/adminSession.js";
import { FAKE_COC_DOWN } from "../../src/debug/fakeCodeOfConduct.js";
import { run, session } from "./actors";

const HUB = "floyd";
const PORT = new URL(process.env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:5173").port || "80";
const ORIGIN = `http://${HUB}.localhost:${PORT}`;
// Through the page's own origin when it proxies /api (a preview build), else the API itself.
const API = process.env.CIVIC_E2E_BASE_URL ? `${ORIGIN}/api` : "http://localhost:3000";
const HOST = { Host: `${HUB}.localhost` };

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...(process.env.CIVIC_E2E_BASE_URL ? {} : HOST) });

async function name(email: string, fullName: string): Promise<void> {
  await localRest(`users?hub_id=eq.${HUB}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ full_name: fullName, display_name: fullName }),
  });
}

async function vote(request: APIRequestContext, token: string, title: string): Promise<string> {
  const created = await request.post(`${API}/process`, {
    headers: auth(token),
    data: {
      definition: { type: "civic.vote", version: "0.1" },
      title,
      description: "A vote for the stream parity check.",
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  const act = await request.post(`${API}/process/${id}/action`, { headers: auth(token), data: { type: "process.activate", payload: {} } });
  expect(act.ok(), await act.text()).toBe(true);
  return id;
}

async function proposal(request: APIRequestContext, resident: string, admin: string, title: string): Promise<string> {
  const draft = await (await request.post(`${API}/proposals/drafts`, { headers: auth(resident), data: { category: "idea" } })).json();
  await request.patch(`${API}/proposals/drafts/${draft.id}`, {
    headers: auth(resident),
    data: { title, description: `A proposal for the stream parity check. ${FAKE_COC_DOWN}` },
  });
  const submitted = await request.post(`${API}/proposals/drafts/${draft.id}/submit`, { headers: auth(resident), data: {} });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const { review_id, process_id } = await submitted.json();
  const approved = await request.post(`${API}/admin/reviews/${review_id}/approve`, { headers: auth(admin), data: {} });
  expect(approved.ok(), await approved.text()).toBe(true);
  return process_id as string;
}

interface Card {
  href: string | null;
  pill: string;
  title: string;
  author: string;
  summary: string;
  rest: string;
  time: string | null;
}

/** Cards compared: into the feed's third page, so "Load more" is crossed twice. */
const CARDS = 60;

/** The feed's first CARDS cards (or all of them, on a shorter feed). */
async function readFeed(page: Page): Promise<Card[]> {
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator("section.feed[aria-busy=true]")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".feed-list-item").first()).toBeVisible();
  const items = page.locator("li.feed-list-item");
  while ((await items.count()) < CARDS) {
    const more = page.locator("button.feed-load-more");
    if ((await more.count()) === 0) break;
    const before = await items.count();
    await more.first().click({ timeout: 15_000 });
    await expect.poll(() => items.count(), { timeout: 15_000 }).toBeGreaterThan(before);
  }
  const cards = await page.locator("li.feed-list-item").evaluateAll((items) =>
    items.map((li) => {
      const text = (sel: string) => (li.querySelector(sel)?.textContent ?? "").trim();
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("time").forEach((t) => t.remove());
      return {
        href: li.querySelector("a")?.getAttribute("href") ?? null,
        pill: text("[data-testid=feed-type-pill]"),
        title: text(".feed-post-title"),
        author: text(".feed-post-author"),
        summary: text(".feed-post-summary"),
        rest: clone.innerText.replace(/\s+/g, " ").trim(),
        time: li.querySelector("time")?.getAttribute("datetime") ?? null,
      };
    }),
  );
  return cards.slice(0, CARDS);
}

test.describe("the feed reads the hub's public stream", () => {
  test.setTimeout(240_000);

  const tokens: Record<"admin" | "member" | "board", string> = { admin: "", member: "", board: "" };
  const names = { admin: `Ada Admin ${run}`, member: `Rita Resident ${run}`, board: `Bo Board ${run}` };
  const emails = { admin: "admin@example.test", member: `stream-member-${run}@example.test`, board: `stream-board-${run}@example.test` };
  let boardBefore: Array<{ value: string }> = [];

  test.beforeAll(async ({ request }) => {
    const config = await (await request.get(`${API}/hub-config`, { headers: process.env.CIVIC_E2E_BASE_URL ? {} : HOST })).json();
    expect(config.hub.id).toBe(HUB);
    expect(config.content.sample_items, "Floyd holds sample content: its feed would read /api/feed").toBe(false);

    // A board member, so an announcement carries an author's name.
    boardBefore = (await localRest(`hub_settings?hub_id=eq.${HUB}&key=eq.people.board_emails&select=value`)) as Array<{ value: string }>;
    await localRest("hub_settings?on_conflict=hub_id,key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ hub_id: HUB, key: "people.board_emails", value: [boardBefore[0]?.value, emails.board].filter(Boolean).join(", ") }),
    });

    for (const who of ["admin", "member", "board"] as const) {
      tokens[who] = (await session(HUB, emails[who])).token;
      await name(emails[who], names[who]);
    }

    // Enough cards of its own to fill what is compared on a fresh stack, and
    // to cross pages of the stream (100 activities) and of the feed (25 cards).
    const votes: string[] = [];
    for (let i = 0; i < CARDS; i++) votes.push(await vote(request, tokens.admin, `Stream vote ${i} ${run}`));
    const source = votes[0]!;
    const closing = await vote(request, tokens.admin, `Stream closed vote ${run}`);
    await request.post(`${API}/process/${closing}/action`, { headers: auth(tokens.member), data: { type: "vote.submit", payload: { option: "Yes" } } });
    await request.post(`${API}/process/${closing}/action`, {
      headers: auth(tokens.admin),
      data: { type: "process.close", payload: { note: "Closed for the stream parity check." } },
    });
    for (let i = 0; i < 3; i++) await proposal(request, tokens.member, tokens.admin, `Stream proposal ${i} ${run}`);
    // A published brief and an official's response to it, the card that
    // carries a person's name (responder_name), written straight into the
    // local stack as the leak harness does: the brief pipeline (generation,
    // review, publication, an official's managed role) is not what this
    // checks. The response's actor is the member, not an office holder, so
    // the views that hide names hide this one.
    const brief = `proc_brief_stream_${run}`;
    const member = (await localRest(`users?hub_id=eq.${HUB}&email=eq.${encodeURIComponent(emails.member)}&select=id`)) as Array<{ id: string }>;
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id: brief, hub_id: HUB, type: "civic.brief", title: `Stream brief ${run}`, description: `Stream brief ${run}`, status: "finalized",
        state: {
          publication_status: "published", published_at: new Date().toISOString(), source_process_id: source, source_process_type: "civic.vote",
          content: { title: `Stream brief ${run}`, headline: `Stream headline ${run}`, participation_label: "1 resident" },
        },
      }),
    });
    const hex = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    for (const [eventType, data] of [
      ["civic.process.result_published", {
        process: { type: "civic.brief" },
        brief: { title: `Stream brief ${run}`, headline: `Stream headline ${run}`, source_process_id: source, source_process_type: "civic.vote" },
        result_of: { iri: `https://${HUB}.civic.social/process/${source}`, id: source, type: "civic.vote" },
      }],
      ["civic.process.action_taken", {
        process: { type: "civic.brief" },
        action: "official_response",
        feed_anchor: true,
        brief: { title: `Stream brief ${run}`, source_process_id: source, source_process_type: "civic.vote" },
        response: { excerpt: "We will look at it.", official_type: "board_of_supervisors", official_title: "Supervisor", responder_name: names.member },
      }],
    ] as const) {
      await localRest("events", {
        method: "POST",
        body: JSON.stringify({
          id: `evt_${hex()}`, hub_id: HUB, event_type: eventType, process_id: brief, actor: member[0]!.id,
          jurisdiction: "us-va-floyd", action_url: `https://${HUB}.civic.social/brief/${brief}`,
          source: { hub_id: HUB, hub_url: `https://${HUB}.civic.social` }, data, meta: { visibility: "public" },
        }),
      });
    }

    for (const [who, title] of [["board", `Board note ${run}`], ["admin", `Admin note ${run}`]] as const) {
      const res = await request.post(`${API}/announcement`, {
        headers: auth(tokens[who]),
        data: { title, body: "An announcement for the stream parity check." },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
  });

  test.afterAll(async () => {
    if (boardBefore.length > 0) {
      await localRest(`hub_settings?hub_id=eq.${HUB}&key=eq.people.board_emails`, {
        method: "PATCH",
        body: JSON.stringify({ value: boardBefore[0]!.value }),
      });
    } else {
      await localRest(`hub_settings?hub_id=eq.${HUB}&key=eq.people.board_emails`, { method: "DELETE" });
    }
  });

  for (const reader of ["signed out", "member", "admin"] as const) {
    test(`${reader}: the same cards, in the same order, with the same names`, async ({ browser }) => {
      const token = reader === "member" ? tokens.member : reader === "admin" ? tokens.admin : null;
      const open = async (source: "internal" | "stream") => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(
          ({ t, s }) => {
            localStorage.setItem("seen_intro_popup", "true");
            localStorage.setItem("welcome-banner-dismissed-v2", "true");
            sessionStorage.setItem("civic_preview", "1");
            if (t) localStorage.setItem("civic_auth_token", t);
            if (s === "internal") sessionStorage.setItem("civic_feed_source", "internal");
          },
          { t: token, s: source },
        );
        const paths: string[] = [];
        page.on("request", (r) => paths.push(new URL(r.url()).pathname));
        const cards = await readFeed(page);
        await context.close();
        return { cards, paths };
      };

      const internal = await open("internal");
      const stream = await open("stream");

      // Each half read what it says it read.
      expect(internal.paths.some((p) => p.endsWith("/feed"))).toBe(true);
      expect(internal.paths.some((p) => p.endsWith("/events"))).toBe(false);
      expect(stream.paths.some((p) => p.endsWith("/events"))).toBe(true);
      expect(stream.paths.some((p) => p.endsWith("/feed"))).toBe(false);

      // The run's own cards are there, so the comparison is not vacuous.
      const titles = stream.cards.map((c) => c.title);
      expect(titles.filter((t) => t.includes(run)).length).toBe(CARDS);
      expect(stream.cards.length).toBe(CARDS);

      // Names first, said outright: each card names exactly whom /api/feed's
      // card named, for this reader. A name the stream shows where /api/feed
      // did not fails here.
      expect(stream.cards.length).toBe(internal.cards.length);
      stream.cards.forEach((c, i) => {
        expect(c.author, `the name on card ${i} (${c.title})`).toBe(internal.cards[i]!.author);
      });
      // Then everything else on every card.
      expect(stream.cards).toEqual(internal.cards);

      // The cards that can carry a name are in the comparison: the board
      // member's announcement, and the official response, whose responder is
      // named to every reader on both (a response is an official's public
      // record).
      expect(stream.cards.find((c) => c.title === `Board note ${run}`), "the board member's announcement").toBeTruthy();
      const response = stream.cards.find((c) => c.title === `Stream brief ${run}` && c.rest.includes("Responding"));
      expect(response, "the official response's card").toBeTruthy();
      expect(response!.author).toContain(names.member);
    });
  }
});
