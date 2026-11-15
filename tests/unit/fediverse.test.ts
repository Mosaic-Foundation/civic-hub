// The Fediverse feature's account (features/fediverse/), end to end in one
// process: a stand-in Mastodon server (another Fedify federation, at
// https://social.example) follows the hub (https://hub.example) and unfollows
// it. Every request between them goes through a stubbed fetch to the other's
// federation, signed and verified exactly as over the network.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Temporal } from "temporal-polyfill";
import { createFederation, MemoryKvStore, type Federation } from "@fedify/fedify";
import { Accept, Announce, Image, Create, Follow, Like, Note, Person, Undo, Endpoints, Delete, Update, type Activity } from "@fedify/vocab";
import { avatarUrl, replyText, federationFor, profileSummary, acceptedUsernames, hubHandle, type FediverseData, type HubFacts } from "../../features/fediverse/federation.js";
import { memoryStore } from "../../features/fediverse/store.js";
import { open as openSealed, seal } from "../../src/services/sealedSecrets.js";

const HUB = "https://hub.example";
const SOCIAL = "https://social.example";

const facts: HubFacts = {
  hubId: "floyd",
  origin: HUB,
  name: "Floyd Civic Hub",
  about: "Vote on local issues.\n\nFloyd County, Virginia.",
  logoUrl: "/logo.png",
  bannerUrl: null,
};
const store = memoryStore();
const blocked: string[] = [];
const data: FediverseData = { facts, store, blocked };

// The stand-in Mastodon: one account, alice, which records what reaches her inbox.
const received: unknown[] = [];
let aliceKeys: CryptoKeyPair | null = null;
const social: Federation<void> = createFederation<void>({ kv: new MemoryKvStore(), allowPrivateAddress: true, origin: SOCIAL });
social
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "alice") return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: "alice",
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKey: keys[0].cryptographicKey,
    });
  })
  .setKeyPairsDispatcher(async () => {
    const { generateCryptoKeyPair } = await import("@fedify/fedify");
    aliceKeys ??= await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    return [aliceKeys];
  });
const created: Create[] = [];
const updated: Update[] = [];
social
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Accept, (_ctx, accept) => {
    received.push(accept);
  })
  .on(Create, (_ctx, create) => {
    created.push(create);
  })
  .on(Update, (_ctx, update) => {
    updated.push(update);
  });

let hub: Federation<FediverseData>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  hub = await federationFor(HUB, { kv: new MemoryKvStore(), allowPrivateAddress: true });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const host = new URL(request.url).origin;
    if (host === HUB) return hub.fetch(request, { contextData: data });
    if (host === SOCIAL) return social.fetch(request, { contextData: undefined });
    throw new Error(`No network in this test: ${request.url}`);
  });
});

afterAll(() => {
  vi.stubGlobal("fetch", realFetch);
});

const alice = new URL(`${SOCIAL}/users/alice`);
const hubActor = new URL(`${HUB}/ap/hub`);

async function asAlice(activity: Activity) {
  const ctx = social.createContext(new URL(SOCIAL), undefined);
  await ctx.sendActivity({ identifier: "alice" }, { id: hubActor, inboxId: new URL(`${HUB}/ap/hub/inbox`) }, activity);
}

describe("the hub's fediverse account", () => {
  it("is found by its handle, long or short", async () => {
    expect(hubHandle(HUB)).toBe("@hub@hub.example");
    expect(hubHandle("https://floyd.civic.social")).toBe("@floyd@floyd.civic.social");
    for (const name of ["hub.example", "hub"]) {
      const res = await fetch(`${HUB}/.well-known/webfinger?resource=acct:${name}@hub.example`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { links: Array<{ rel: string; href: string }> };
      expect(body.links.find((l) => l.rel === "self")?.href).toBe(hubActor.href);
    }
    const nobody = await fetch(`${HUB}/.well-known/webfinger?resource=acct:someone@hub.example`);
    expect(nobody.status).toBe(404);
    expect(acceptedUsernames("https://floyd.civic.social")).toEqual(["floyd.civic.social", "floyd", "hub"]);
  });

  it("has a profile that says what it is and links to the hub", async () => {
    const res = await fetch(hubActor, { headers: { Accept: "application/activity+json" } });
    expect(res.status).toBe(200);
    const actor = (await res.json()) as Record<string, unknown>;
    expect(actor.type).toBe("Service");
    expect(actor.preferredUsername).toBe("hub");
    expect(actor.name).toBe("Floyd Civic Hub");
    expect(actor.url).toBe(`${HUB}/`);
    expect(actor.manuallyApprovesFollowers).toBe(false);
    expect((actor.icon as { url: string }).url).toBe(`${HUB}/logo.png`);
    // No logo: a letter picture of the hub's name.
    expect(avatarUrl({ ...facts, logoUrl: null })?.href).toBe(`${HUB}/fediverse-avatars/F.png`);
    expect(avatarUrl({ ...facts, logoUrl: null, name: "4H Club" })?.href).toBe(`${HUB}/fediverse-avatars/H.png`);
    expect(avatarUrl({ ...facts, logoUrl: null, name: "123" })?.href).toBe(`${HUB}/fediverse-avatars/C.png`);
    expect(String(actor.summary)).toContain("An independent Civic Hub");
    expect((actor.publicKey as { publicKeyPem: string }).publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  it("escapes the hub's own text in its profile", () => {
    const html = profileSummary({ ...facts, about: "<script>x</script> & more" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; more");
  });

  it("keeps its private keys sealed", async () => {
    const keys = await store.keys();
    expect(keys).not.toBeNull();
    expect(keys!.rsa_private_sealed.startsWith("v1.")).toBe(true);
    expect(keys!.rsa_private_sealed).not.toContain('"d"');
    // Sealed for this hub: another hub's id does not open it.
    expect(() => openSealed("fediverse-signing-key", "athens", keys!.rsa_private_sealed)).toThrow();
    expect(JSON.parse(openSealed("fediverse-signing-key", "floyd", keys!.rsa_private_sealed)).kty).toBe("RSA");
    expect(openSealed("x", "h", seal("x", "h", "secret"))).toBe("secret");
  });

  it("accepts a follow, stores the follower and counts them", async () => {
    const follow = new Follow({ id: new URL(`${SOCIAL}/follows/1`), actor: alice, object: hubActor });
    await asAlice(follow);
    expect(store.followers.get(alice.href)).toMatchObject({
      actor_uri: alice.href,
      inbox_url: `${SOCIAL}/users/alice/inbox`,
      shared_inbox_url: `${SOCIAL}/inbox`,
      handle: "@alice@social.example",
      follow_id: `${SOCIAL}/follows/1`,
    });
    expect(received).toHaveLength(1);
    const accept = received[0] as Accept;
    expect(accept.actorId?.href).toBe(hubActor.href);
    expect(accept.objectId?.href).toBe(`${SOCIAL}/follows/1`);

    const res = await fetch(`${HUB}/ap/hub/followers`, { headers: { Accept: "application/activity+json" } });
    const col = (await res.json()) as { totalItems: number; orderedItems?: unknown[] };
    expect(col.totalItems).toBe(1);
    // How many, never who.
    expect(col.orderedItems ?? []).toEqual([]);
  });

  it("ignores a follow of some other account", async () => {
    const before = store.followers.size;
    await asAlice(new Follow({ id: new URL(`${SOCIAL}/follows/2`), actor: alice, object: new URL(`${HUB}/ap/someone`) }));
    expect(store.followers.size).toBe(before);
  });

  it("removes the follower on Undo", async () => {
    const follow = new Follow({ id: new URL(`${SOCIAL}/follows/1`), actor: alice, object: hubActor });
    await asAlice(new Undo({ id: new URL(`${SOCIAL}/follows/1/undo`), actor: alice, object: follow }));
    expect(store.followers.has(alice.href)).toBe(false);
  });

  it("removes a follower whose account is deleted", async () => {
    await asAlice(new Follow({ id: new URL(`${SOCIAL}/follows/3`), actor: alice, object: hubActor }));
    expect(store.followers.has(alice.href)).toBe(true);
    await asAlice(new Delete({ id: new URL(`${SOCIAL}/users/alice#delete`), actor: alice, object: alice }));
    expect(store.followers.has(alice.href)).toBe(false);
  });

  it("refuses an unsigned follow", async () => {
    const res = await fetch(`${HUB}/ap/hub/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${SOCIAL}/follows/forged`,
        type: "Follow",
        actor: alice.href,
        object: hubActor.href,
      }),
    });
    expect(res.status).toBe(401);
    expect(store.followers.has(alice.href)).toBe(false);
  });
});

// --- Phase 2: posting, delivery, limits ------------------------------------

import { announceProfile, deliverDue, postNew, type JobDeps } from "../../features/fediverse/job.js";
import { hashtag, hubHashtags, roundupDue, POSTED_KINDS, itemContent } from "../../features/fediverse/posts.js";
import { blockedServers, isBlocked, serverOf, signingServer, deliverable } from "../../features/fediverse/limits.js";
import { BACKOFF_MINUTES, nextAttempt } from "../../features/fediverse/deliver.js";
import { decodeKey, encodeKey } from "../../features/fediverse/kv.js";
import type { PublicActivityItem, PublicActivityPage } from "../../src/sdk/index.js";

function item(n: number, kind = "vote-open", pill = "Vote"): PublicActivityItem {
  return {
    event_id: `evt_${n}`,
    recorded_at: new Date(Date.UTC(2026, 10, 14, 12, n)).toISOString(),
    event_type: "civic.process.started",
    kind,
    pill,
    process_id: `proc_${n}`,
    process_type: "civic.vote",
    title: `Skate park <${n}>`,
    url: `${HUB}/process/proc_${n}`,
    activity_iri: `${HUB}/activities/evt_${n}`,
    process_iri: `${HUB}/process/proc_${n}`,
    description: n === 40 ? "Where should the new skate park go? Three sites are on the table…" : null,
    image: n === 40 ? { url: `${HUB}/images/park.jpg`, alt: "The old tennis courts" } : null,
  };
}

/** A host whose public activity is `feed`, after `since`, and whose switch went on at `on`. */
function hostWith(feed: PublicActivityItem[], on: string | null = "2026-11-14T12:20:00Z"): JobDeps["host"] {
  return {
    switchedOnAt: async () => on,
    async publicActivity(since, options): Promise<PublicActivityPage> {
      const after = feed.filter((i) => i.recorded_at > since && (!options?.kinds || options.kinds.has(i.kind)));
      return { items: after, cursor: after.length ? after[after.length - 1]!.recorded_at : null };
    },
  };
}

function deps(feed: PublicActivityItem[], extra: Partial<JobDeps> = {}): JobDeps {
  return {
    host: hostWith(feed),
    store,
    facts,
    federation: hub,
    send: (request) => fetch(request),
    timeZone: "America/New_York",
    blocked,
    mode: "each",
    ...extra,
  };
}

describe("the hub's posts", () => {
  it("starts from the moment it is switched on: nothing from before is posted, what came after is", async () => {
    // alice follows again, for deliveries.
    await asAlice(new Follow({ id: new URL(`${SOCIAL}/follows/9`), actor: alice, object: hubActor }));
    // item(1) is at 12:01, before the switch (12:20); item(25) at 12:25, after it, before the first run.
    const first = await postNew(deps([item(1), item(25)]), new Date("2026-11-14T12:30:00Z"));
    expect(first).toEqual({ posted: 1, started: true });
    expect(store.allPosts.map((p) => p.event_id)).toEqual(["evt_25"]);
    // Delivered now, so the counts below are this test's own.
    await deliverDue(deps([]), new Date("2026-11-14T12:30:00Z"));
    created.length = 0;
  });

  it("never reaches back more than a week, and starts now when the switch time is unknown", async () => {
    const fresh = memoryStore();
    await postNew(deps([], { store: fresh, host: hostWith([], "2026-01-01T00:00:00Z") }), new Date("2026-11-14T12:00:00Z"));
    expect(await fresh.getState("cursor")).toBe("2026-11-07T12:00:00.000Z");
    const none = memoryStore();
    await postNew(deps([], { store: none, host: hostWith([], null) }), new Date("2026-11-14T12:00:00Z"));
    expect(await none.getState("cursor")).toBe("2026-11-14T12:00:00.000Z");
  });

  it("posts each new item that opens or is decided, once, and nothing else", async () => {
    const feed = [item(40), item(41, "brief", "Brief"), item(42, "meeting", "Meeting summary")];
    const now = new Date("2026-11-14T13:00:00Z");
    expect((await postNew(deps(feed), now)).posted).toBe(2);
    expect((await postNew(deps(feed), now)).posted).toBe(0);
    expect(store.allPosts.map((p) => p.event_id).sort()).toEqual(["evt_25", "evt_40", "evt_41"]);
    const post = store.allPosts.find((p) => p.event_id === "evt_40")!;
    expect(post.content).toContain("<strong>New vote:</strong> Skate park &lt;40&gt;");
    // The description as the page's link preview has it; cut, so "Read more".
    expect(post.content).toContain("<p>Where should the new skate park go? Three sites are on the table…</p>");
    expect(post.content).toContain(`Read more: <a href="${HUB}/process/proc_40">`);
    expect(post.image_url).toBe(`${HUB}/images/park.jpg`);
    // An item with no description: no paragraph for it, and no "Read more".
    const plain = store.allPosts.find((p) => p.event_id === "evt_41")!;
    expect(plain.content).not.toContain("Read more");
    expect(post.content).toContain("#<span>CivicHub</span>");
    expect(post.content).toContain("#<span>Floyd</span>");
    // Queued once, to alice's server's shared inbox.
    expect([...store.deliveries.values()].filter((d) => d.post_id === post.id).map((d) => d.inbox_url)).toEqual([`${SOCIAL}/inbox`]);
  });

  it("delivers a post signed, and the follower's server reads it as the hub's", async () => {
    const result = await deliverDue(deps([]), new Date("2026-11-14T13:01:00Z"));
    expect(result).toEqual({ delivered: 2, failed: 0, gave_up: 0 });
    expect(created).toHaveLength(2);
    const note = (await created[0]!.getObject()) as Note;
    expect(created[0]!.actorId?.href).toBe(hubActor.href);
    expect(note.content?.toString()).toMatch(/Skate park/);
    expect(note.toIds.map(String)).toContain("https://www.w3.org/ns/activitystreams#Public");
    // What a reader following the hub both ways matches on (docs/FEDIVERSE.md):
    // the item's process IRI as the Note's context, its page and its civic
    // activity as the Note's urls.
    const notes = await Promise.all(created.map(async (c) => (await c.getObject()) as Note));
    const vote = notes.find((x) => x.contextIds.map(String).includes(`${HUB}/process/proc_40`))!;
    expect(vote).toBeDefined();
    const urls = JSON.stringify(((await vote.toJsonLd({ format: "compact" })) as Record<string, unknown>).url);
    expect(urls).toContain(`${HUB}/activities/evt_40`);
    expect(urls).toContain(`${HUB}/process/proc_40`);
    // Its picture, attached by address, with its description and type.
    const pics: unknown[] = [];
    for await (const a of vote.getAttachments()) pics.push(a);
    expect(pics).toHaveLength(1);
    expect(String((pics[0] as { url: URL }).url)).toBe(`${HUB}/images/park.jpg`);
    expect(String((pics[0] as { mediaType: string }).mediaType)).toBe("image/jpeg");
    expect(String((pics[0] as { name: unknown }).name)).toBe("The old tennis courts");
    // Nothing left to deliver.
    expect((await deliverDue(deps([]), new Date("2026-11-14T13:02:00Z"))).delivered).toBe(0);
  });

  it("serves each post at its own address, and lists them in the outbox", async () => {
    const post = store.allPosts[0]!;
    const res = await fetch(`${HUB}/ap/hub/posts/${post.id}`, { headers: { Accept: "application/activity+json" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { type: string }).type).toBe("Note");
    const outbox = (await (await fetch(`${HUB}/ap/hub/outbox`, { headers: { Accept: "application/activity+json" } })).json()) as { totalItems: number };
    expect(outbox.totalItems).toBe(3);
  });

  it("retries a server that fails, and gives up on an inbox that is gone", async () => {
    const now = new Date("2026-11-14T14:00:00Z");
    await postNew(deps([item(50)]), now);
    const down = await deliverDue(deps([], { send: async () => new Response("", { status: 503 }) }), now);
    expect(down).toEqual({ delivered: 0, failed: 1, gave_up: 0 });
    const row = [...store.deliveries.values()].find((d) => !d.delivered_at && !d.gave_up_at)!;
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBe(new Date(now.getTime() + 60_000).toISOString());
    // Not due again until then.
    expect((await deliverDue(deps([], { send: async () => new Response("", { status: 410 }) }), now)).gave_up).toBe(0);
    const gone = await deliverDue(deps([], { send: async () => new Response("", { status: 410 }) }), new Date(now.getTime() + 61_000));
    expect(gone.gave_up).toBe(1);
    expect(nextAttempt(1, now, 500)).toBe(new Date(now.getTime() + 60_000).toISOString());
    expect(nextAttempt(BACKOFF_MINUTES.length + 1, now, 500)).toBeNull();
  });

  it("rounds up a day's items in one post, on a day with something new, after 8 in the morning", async () => {
    const quiet = memoryStore();
    await quiet.setState("cursor", "2026-11-14T00:00:00Z");
    const feed = [1, 2, 3, 4, 5, 6, 7].map((n) => item(n));
    const daily = (at: string, s = quiet, f = feed) => postNew(deps(f, { store: s, mode: "daily" }), new Date(at));
    // 7 AM in New York: not yet.
    expect((await daily("2026-11-14T12:00:00Z")).posted).toBe(0);
    expect((await daily("2026-11-14T13:30:00Z")).posted).toBe(1);
    const [roundup] = quiet.allPosts;
    expect(roundup!.kind).toBe("roundup");
    expect(roundup!.items).toHaveLength(7);
    expect(roundup!.content).toContain("7 new items");
    expect(roundup!.content).toContain("and 2 more");
    expect(roundup!.url).toBe(`${HUB}/fediverse/roundups/${roundup!.id}`);
    // Once a day.
    expect((await daily("2026-11-14T20:00:00Z")).posted).toBe(0);
    // A day with nothing new posts nothing.
    expect((await daily("2026-11-15T13:30:00Z")).posted).toBe(0);
    expect(roundupDue("weekly", new Date("2026-11-16T14:00:00Z"), "America/New_York", null).due).toBe(true); // a Monday
    expect(roundupDue("weekly", new Date("2026-11-17T14:00:00Z"), "America/New_York", null).due).toBe(false);
  });

  it("makes hashtags from the hub's name and its admins' list", () => {
    expect(hashtag("Floyd County")).toBe("FloydCounty");
    expect(hashtag("!!")).toBeNull();
    expect(hubHashtags("Floyd Civic Hub", "#FloydVA, floyd county")).toEqual(["CivicHub", "Floyd", "FloydVA", "FloydCounty"]);
    expect(POSTED_KINDS.has("vote-open")).toBe(true);
    expect(POSTED_KINDS.has("meeting")).toBe(false);
  });

  it("never names anyone, and escapes the title", () => {
    const html = itemContent({ ...item(60), title: `<img src=x onerror=alert(1)>` }, ["CivicHub"], HUB);
    expect(html).not.toContain("<img");
  });
});

describe("the hub's profile", () => {
  it("tells followers' servers once when it changes, so Mastodon shows the new handle or logo now", async () => {
    // alice follows (again) for this.
    await asAlice(new Follow({ id: new URL(`${SOCIAL}/follows/20`), actor: alice, object: hubActor }));
    updated.length = 0;
    expect(await announceProfile(deps([]))).toBe(1);
    expect(updated).toHaveLength(1);
    const actor = await updated[0]!.getObject();
    expect(String((actor as unknown as { preferredUsername: unknown }).preferredUsername)).toBe("hub");
    // Unchanged: nothing sent.
    expect(await announceProfile(deps([]))).toBe(0);
    // A new logo: sent again.
    expect(await announceProfile(deps([], { facts: { ...facts, logoUrl: "/new-logo.png" } }))).toBe(1);
    expect(updated).toHaveLength(2);
  });
});

describe("what comes back", () => {
  const replyTo = () => new URL(`${HUB}/ap/hub/posts/${store.allPosts[0]!.id}`);
  const replyId = new URL(`${SOCIAL}/users/alice/statuses/1`);
  const reply = (content: string, inReplyTo: URL, by: URL = alice) =>
    new Note({ id: replyId, attribution: by, replyTarget: inReplyTo, content, url: new URL(`${SOCIAL}/@alice/1`), published: Temporal.Instant.from("2026-11-15T12:00:00Z"), attachments: [new Image({ url: new URL(`${SOCIAL}/media/1.jpg`) })] });

  it("keeps a reply to a hub post as text, with links to its pictures", async () => {
    await asAlice(new Create({ id: new URL(`${SOCIAL}/users/alice/statuses/1/activity`), actor: alice, object: reply("<p>Great idea &amp; thanks!</p><p>Line two<br>three</p>", replyTo()) }));
    const kept = store.replies.get(replyId.href)!;
    expect(kept).toMatchObject({ actor_uri: alice.href, actor_handle: "@alice@social.example", post_id: store.allPosts[0]!.id });
    expect(kept.text).toBe("Great idea & thanks!\n\nLine two\nthree");
    expect(kept.media_links).toEqual([`${SOCIAL}/media/1.jpg`]);
  });

  it("keeps the new text when its author edits it, and deletes it when they delete it", async () => {
    await asAlice(new Update({ id: new URL(`${SOCIAL}/users/alice/statuses/1#updates/1`), actor: alice, object: reply("<p>Edited</p>", replyTo()) }));
    expect(store.replies.get(replyId.href)!.text).toBe("Edited");
    await asAlice(new Delete({ id: new URL(`${SOCIAL}/users/alice/statuses/1#delete`), actor: alice, object: replyId }));
    expect(store.replies.has(replyId.href)).toBe(false);
  });

  it("ignores a note that answers nothing of the hub's, or that someone else wrote", async () => {
    await asAlice(new Create({ id: new URL(`${SOCIAL}/a/2`), actor: alice, object: reply("hi", new URL(`${SOCIAL}/users/bob/statuses/9`)) }));
    await asAlice(new Create({ id: new URL(`${SOCIAL}/a/3`), actor: alice, object: reply("hi", replyTo(), new URL(`${SOCIAL}/users/bob`)) }));
    expect(store.replies.size).toBe(0);
  });

  it("counts a like and a boost once each, and takes them back on Undo", async () => {
    const like = new Like({ id: new URL(`${SOCIAL}/likes/1`), actor: alice, object: replyTo() });
    await asAlice(like);
    await asAlice(new Like({ id: new URL(`${SOCIAL}/likes/2`), actor: alice, object: replyTo() }));
    await asAlice(new Announce({ id: new URL(`${SOCIAL}/boosts/1`), actor: alice, object: replyTo(), to: new URL("https://www.w3.org/ns/activitystreams#Public") }));
    expect([...store.reactions.values()].map((r) => r.kind).sort()).toEqual(["boost", "like"]);
    const now = new Date();
    const counts = await store.returnsSince(new Date(now.getTime() - 60_000).toISOString(), new Date(now.getTime() + 60_000).toISOString());
    expect(counts).toEqual({ replies: 0, likes: 1, boosts: 1 });
    await asAlice(new Undo({ id: new URL(`${SOCIAL}/likes/1#undo`), actor: alice, object: like }));
    expect([...store.reactions.values()].map((r) => r.kind)).toEqual(["boost"]);
    // A like of something that isn't a hub post is not counted.
    await asAlice(new Like({ id: new URL(`${SOCIAL}/likes/3`), actor: alice, object: new URL(`${SOCIAL}/users/bob/statuses/9`) }));
    expect(store.reactions.size).toBe(1);
  });

  it("forgets an account's replies, likes and boosts when the account is deleted", async () => {
    await asAlice(new Create({ id: new URL(`${SOCIAL}/a/4`), actor: alice, object: reply("again", replyTo()) }));
    expect(store.replies.size).toBe(1);
    await asAlice(new Delete({ id: new URL(`${SOCIAL}/users/alice#delete2`), actor: alice, object: alice }));
    expect(store.replies.size).toBe(0);
    expect(store.reactions.size).toBe(0);
  });

  it("reads a reply's words out of its markup", () => {
    expect(replyText("<p><span class=\"h-card\"><a href=\"x\">@<span>hub</span></a></span> yes &#x1F44D; &lt;b&gt;</p>")).toBe("@hub yes 👍 <b>");
    expect(replyText("x".repeat(6000))).toHaveLength(5000);
  });
});

describe("the hub's limits", () => {
  it("reads a server from what an admin types, and blocks it and everything under it", () => {
    expect(serverOf("Mastodon.Social")).toBe("mastodon.social");
    expect(serverOf("@spam@bad.example")).toBe("bad.example");
    expect(serverOf("https://bad.example/about")).toBe("bad.example");
    expect(serverOf("# a note")).toBeNull();
    expect(isBlocked("a.bad.example", ["bad.example"])).toBe(true);
    expect(isBlocked("notbad.example", ["bad.example"])).toBe(false);
    expect(blockedServers()).toEqual([]);
  });

  it("names the server that signed a request", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
    expect(signingServer(h({ signature: 'keyId="https://Social.Example/users/a#main-key",headers="(request-target)"' }))).toBe("social.example");
    expect(signingServer(h({ "signature-input": 'sig1=("@method");keyid="https://x.example/k"' }))).toBe("x.example");
    expect(signingServer(h({}))).toBeNull();
  });

  it("delivers only to https", () => {
    expect(deliverable("https://social.example/inbox")).toBe(true);
    expect(deliverable("http://social.example/inbox")).toBe(false);
    expect(deliverable("not a url")).toBe(false);
  });

  it("ignores a follow from a blocked server", async () => {
    await asAlice(new Undo({ id: new URL(`${SOCIAL}/follows/9/undo`), actor: alice, object: new Follow({ id: new URL(`${SOCIAL}/follows/9`), actor: alice, object: hubActor }) }));
    expect(store.followers.has(alice.href)).toBe(false);
    blocked.push("social.example");
    try {
      await asAlice(new Follow({ id: new URL(`${SOCIAL}/follows/10`), actor: alice, object: hubActor }));
      expect(store.followers.has(alice.href)).toBe(false);
    } finally {
      blocked.length = 0;
    }
  });

  it("keeps Fedify's memory under keys a LIKE can list by prefix", () => {
    const key = ["_fedify", "activityIdempotence", "https://x.example/a_b%c"] as const;
    const encoded = encodeKey(key);
    expect(encoded).toMatch(/^[0-9a-f.]+$/);
    expect(decodeKey(encoded)).toEqual(key);
    expect(encoded.startsWith(`${encodeKey(["_fedify"])}.`)).toBe(true);
  });
});
