// The Fediverse feature's account (features/fediverse/), end to end in one
// process: a stand-in Mastodon server (another Fedify federation, at
// https://social.example) follows the hub (https://hub.example) and unfollows
// it. Every request between them goes through a stubbed fetch to the other's
// federation, signed and verified exactly as over the network.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFederation, MemoryKvStore, type Federation } from "@fedify/fedify";
import { Accept, Follow, Person, Undo, Endpoints, Delete } from "@fedify/vocab";
import { federationFor, profileSummary, acceptedUsernames, hubHandle, type FediverseData, type HubFacts } from "../../features/fediverse/federation.js";
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
const data: FediverseData = { facts, store };

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
social.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(Accept, (_ctx, accept) => {
  received.push(accept);
});

let hub: Federation<FediverseData>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  hub = await federationFor(HUB, { allowPrivateAddress: true });
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

async function asAlice(activity: Follow | Undo | Delete) {
  const ctx = social.createContext(new URL(SOCIAL), undefined);
  await ctx.sendActivity({ identifier: "alice" }, { id: hubActor, inboxId: new URL(`${HUB}/ap/hub/inbox`) }, activity);
}

describe("the hub's fediverse account", () => {
  it("is found by its handle, long or short", async () => {
    expect(hubHandle(HUB)).toBe("@hub.example@hub.example");
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
    expect(actor.preferredUsername).toBe("hub.example");
    expect(actor.name).toBe("Floyd Civic Hub");
    expect(actor.url).toBe(`${HUB}/`);
    expect(actor.manuallyApprovesFollowers).toBe(false);
    expect((actor.icon as { url: string }).url).toBe(`${HUB}/logo.png`);
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
